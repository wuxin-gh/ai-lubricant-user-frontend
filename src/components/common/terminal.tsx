import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import React from 'react';
import themes from '@/utils/terminalThemes';
import { b64decode, b64encode } from '@/utils/common';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Spinner } from '@/components/ui/spinner';

const isWebglSupported = (): boolean => {
  if (typeof document === 'undefined') {
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
};

const buildWebSocketUrl = (rawUrl: string): string => {
  if (!rawUrl) {
    return rawUrl;
  }

  if (rawUrl.startsWith('ws://') || rawUrl.startsWith('wss://')) {
    return rawUrl;
  }

  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    const normalized = new URL(rawUrl);
    normalized.protocol = normalized.protocol === 'https:' ? 'wss:' : 'ws:';
    return normalized.toString();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`;
};

/**
 * Read-only accessors a parent can hold onto (handed over via `onReady`).
 * Used by the node terminal page to attach the current terminal tail as
 * per-turn context for the AI assistant.
 */
export interface TerminalHandle {
  /** Last `n` non-empty lines of the xterm buffer, oldest first. */
  getRecentLines: (n: number) => string[]
  /** Reopen only the WebSocket/PTY bridge while preserving xterm scrollback. */
  reconnect: () => void
  /** Current node/terminal identity and whether the PTY bridge is connected. */
  getIdentity: () => { terminalId: string; connected: boolean }
  /**
   * Explicitly terminate the terminal: asks the server to kill the node PTY (and
   * with it any foreground command), instead of merely detaching. Closing the tab
   * or losing the network only detaches — the PTY survives for a later reattach —
   * so this is the deliberate "I am done with this shell" action.
   */
  closeTerminal: () => void
}

interface TerminalProps {
  ws: string
  theme: string
  signal: number
  onTitleChanged: ((env: string) => void) | null
  onUserNameChanged: ((userName: string, userAvatar: string) => void) | null
  onConnectionStatusChanged: ((status: 'connecting' | 'connected' | 'disconnected') => void) | null
  /** Called once the xterm instance exists, with stable read accessors. */
  onReady?: ((handle: TerminalHandle) => void) | null
  /**
   * The server tees an agent command's output through this same PTY, so it
   * emits `agent_command_start`/`agent_command_end` frames. While a command
   * runs the terminal disables its own stdin (the operator's keystrokes would
   * otherwise interleave with the command's input line) — this reports that
   * state so the page can show a banner.
   */
  onAgentCommandChanged?: ((running: boolean, command: string) => void) | null
}

export default function Terminal({
  ws = '',
  theme = '',
  signal = 0,
  onTitleChanged = null,
  onUserNameChanged = null,
  onConnectionStatusChanged = null,
  onReady = null,
  onAgentCommandChanged = null,
}: TerminalProps) {
  const { t } = useTranslation();

  // Validate the theme, then fall back to localStorage and the default theme.
  // 存量值 'MonkeyCode'（品牌改名前）一次性映射为 'AiLubricant'。
  const validTheme = React.useMemo(() => {
    if (theme && theme in themes) {
      return theme;
    }
    let savedTheme = localStorage.getItem('terminalTheme');
    if (savedTheme === 'MonkeyCode') {
      localStorage.setItem('terminalTheme', 'AiLubricant');
      savedTheme = 'AiLubricant';
    }
    if (savedTheme && savedTheme in themes) {
      return savedTheme;
    }
    return 'AiLubricant';
  }, [theme]);

  const terminalDiv = React.useRef(null);
  const xtermInstance = React.useRef<XTerm | null>(null);
  const websocketInstance = React.useRef<WebSocket | null>(null);
  const fitAddonRef = React.useRef<FitAddon | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [connected, setConnected] = React.useState(false);
  const [reconnectProgress, setReconnectProgress] = React.useState<{ attempt: number; seconds: number } | null>(null);
  const reconnectingRef = React.useRef(false);
  const pingLooper = React.useRef<number | null>(null);
  // 终端空闲断开：用户无输入且服务端无输出超过阈值时主动断开，释放节点 PTY。
  // ping 是保活心跳、不算用户活动，不会重置该计时器。
  const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
  const lastActivityRef = React.useRef<number>(0);
  const idleTimerRef = React.useRef<number | null>(null);
  const reconnectTimerRef = React.useRef<number | null>(null);
  const reconnectAttemptRef = React.useRef(0);
  const manualDisconnectRef = React.useRef(false);
  const everConnectedRef = React.useRef(false);
  // Identity from the server's `connected` frame. The agent needs it to target
  // this exact PTY; cleared on disconnect so a stale id is never sent.
  const terminalIdRef = React.useRef('');
  // True while the server is running an agent command in this PTY. Keystrokes
  // are dropped locally AND by the gateway — this ref is the local half.
  const agentCommandRef = React.useRef(false);
  // beforeunload 需要读到最新的连接状态，空依赖 effect 闭包会读到旧值，用 ref 镜像。
  const connectedRef = React.useRef(false);

  const setAgentCommandRunning = (running: boolean, command: string) => {
    agentCommandRef.current = running;
    if (xtermInstance.current) {
      // Do not re-enable stdin if a reconnect overlay is also holding it down.
      xtermInstance.current.options.disableStdin = running || reconnectingRef.current;
    }
    onAgentCommandChanged?.(running, command);
  };

  const setReconnectState = (progress: { attempt: number; seconds: number } | null) => {
    reconnectingRef.current = progress !== null;
    setReconnectProgress(progress);
    if (xtermInstance.current) {
      xtermInstance.current.options.disableStdin = progress !== null;
    }
  };

  React.useEffect(() => {
    connectedRef.current = connected;
    onConnectionStatusChanged?.(connecting ? 'connecting' : connected ? 'connected' : 'disconnected');
  }, [connecting, connected])

  const handleResize = () => {
    if (xtermInstance.current) {
      fitAddonRef.current?.fit();
      // readyState 1 means the websocket is open.
      if (websocketInstance.current && websocketInstance.current.readyState === 1) {
        websocketInstance.current.send(JSON.stringify({
          type: "resize",
          data: JSON.stringify({
            row: xtermInstance.current?.rows,
            col: xtermInstance.current?.cols
          })
        }));
      }
    }
  };


  React.useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (connectedRef.current) {
        event.preventDefault();
        event.returnValue = ''; // Chrome requires returnValue.
        return ''; // Other browsers.
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Watch container size changes with ResizeObserver.
  React.useEffect(() => {
    if (!terminalDiv.current) return;

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    resizeObserver.observe(terminalDiv.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  React.useEffect(() => {
    if (xtermInstance.current) {
      xtermInstance.current.options.theme = { ...themes[validTheme as keyof typeof themes] };
      if (xtermInstance.current.rows > 0) {
        xtermInstance.current.refresh(0, xtermInstance.current.rows - 1);
      }
      xtermInstance.current.focus();
    }
  }, [validTheme])

  const resetTerminal = () => {
    // Mark intentional so the outgoing socket's onclose (fired asynchronously
    // after .close()) does not schedule a background reconnect against the
    // about-to-be-disposed instance.
    manualDisconnectRef.current = true;
    clearReconnect();
    if (xtermInstance.current) {
      xtermInstance.current.dispose();
      xtermInstance.current = null;
    }
    if (websocketInstance.current) {
      websocketInstance.current.close();
      websocketInstance.current = null;
    }
    if (pingLooper.current) {
      clearInterval(pingLooper.current);
      pingLooper.current = null;
    }
    if (idleTimerRef.current) {
      clearInterval(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    setReconnectState(null);
    setConnecting(false);
    setConnected(false);
  }

  // Any real user input or server output marks the session active. The idle
  // watchdog (below) disconnects only after IDLE_TIMEOUT_MS with no such marks,
  // so the node's PTY is released instead of lingering on an abandoned tab.
  const markActivity = () => {
    lastActivityRef.current = Date.now();
  };

  // Disconnect an idle terminal: close the socket so the server's bridge hits
  // its finally and sends NodeTerminalClose, freeing the host shell. ping frames
  // do NOT call markActivity, so keep-alive alone cannot defeat this.
  const disconnectIdle = () => {
    manualDisconnectRef.current = true;
    clearReconnect();
    if (websocketInstance.current) {
      websocketInstance.current.close();
      websocketInstance.current = null;
    }
    if (pingLooper.current) {
      clearInterval(pingLooper.current);
      pingLooper.current = null;
    }
    if (idleTimerRef.current) {
      clearInterval(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    setReconnectState(null);
    setConnecting(false);
    setConnected(false);
    xtermInstance.current?.writeln(`\r\n\x1b[33m${t("common.terminal.idleDisconnected")}\x1b[0m`);
    toast.info(t("common.terminal.idleDisconnected"));
  };

  // Cancel any pending background reconnect. Called on intentional teardown
  // (unmount, manual reconnect, idle disconnect) so a stale timer can't fire
  // connectWebSocket() after the component has moved on.
  const clearReconnect = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  // Auth/permission denials are permanent — retrying would spam the audit log
  // and never succeed. Normal close (1000) is intentional (e.g. the shell
  // exited). Everything else (network drop 1006, server restart 1011, node
  // briefly unavailable 4503, …) is worth a background retry.
  const isReconnectable = (code: number) => {
    if (code === 4401 || code === 4403 || code === 1000) return false;
    return true;
  };

  // Schedule a single background reconnect with exponential backoff. Reuses the
  // existing xterm instance (so scrollback is preserved) and just opens a fresh
  // WebSocket — the user does not need to refresh or click "重连". The attempt
  // counter resets to 0 once the server sends its `connected` frame, so a clean
  // recovery restarts the backoff from the top.
  const MAX_RECONNECT_ATTEMPTS = 8;
  const scheduleReconnect = () => {
    if (manualDisconnectRef.current) return;
    if (reconnectTimerRef.current) return; // already pending
    if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
      clearReconnect();
      reconnectAttemptRef.current = 0;
      setReconnectState(null);
      xtermInstance.current?.writeln(`\r\n\x1b[31m${t("common.terminal.reconnectFailed")}\x1b[0m`);
      toast.error(t("common.terminal.reconnectFailed"));
      return;
    }
    const attempt = reconnectAttemptRef.current;
    reconnectAttemptRef.current += 1;
    // 1s, 2s, 4s, 8s, 16s, 30s, 30s, 30s — capped.
    const delay = Math.min(1000 * 2 ** attempt, 30000);
    const seconds = Math.max(1, Math.round(delay / 1000));
    setReconnectState({ attempt: attempt + 1, seconds });
    setConnecting(true);
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      // The component may have been torn down while we waited.
      if (manualDisconnectRef.current || !xtermInstance.current) return;
      connectWebSocket();
    }, delay);
  };


  const reconnectSocket = () => {
    if (!xtermInstance.current || !ws) return;
    clearReconnect();
    reconnectAttemptRef.current = 0;
    manualDisconnectRef.current = false;
    // Explicit reconnect is a user-requested recovery even when the initial
    // terminal open never reached `connected`; subsequent transient closes may
    // therefore use the normal background backoff.
    everConnectedRef.current = true;

    // Detach the old socket before closing it. Its asynchronous onclose callback
    // then fails the identity guard and cannot schedule a second reconnect.
    const previousSocket = websocketInstance.current;
    websocketInstance.current = null;
    previousSocket?.close();
    if (pingLooper.current) {
      clearInterval(pingLooper.current);
      pingLooper.current = null;
    }
    if (idleTimerRef.current) {
      clearInterval(idleTimerRef.current);
      idleTimerRef.current = null;
    }

    setConnected(false);
    setConnecting(true);
    setReconnectState({ attempt: 1, seconds: 0 });
    connectWebSocket();
  };

  // Explicitly terminate the node PTY (and its foreground processes) instead of
  // just detaching. A plain socket close leaves the shell alive on the node so a
  // later reconnect with the same terminal_id resumes it; this `close` frame is
  // what tells the server the operator is really done with the shell. Sent
  // best-effort: if the socket is already gone the server-side detached TTL will
  // reap the terminal anyway.
  const closeTerminal = () => {
    const socket = websocketInstance.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: 'close' }));
      } catch {
        // The socket died between the readyState check and the send; the
        // server's detached reaper is the backstop.
      }
    }
    // Mark the teardown intentional so the pending onclose does not schedule a
    // background reconnect against a terminal we just asked to be killed.
    manualDisconnectRef.current = true;
    clearReconnect();
    setReconnectState(null);
  };

  const connectTerminal = async () => {
    if (!ws) {
      return;
    }
    resetTerminal();
    // resetTerminal marked the teardown intentional; this fresh connect clears
    // that flag and starts the reconnect backoff from the top.
    manualDisconnectRef.current = false;
    everConnectedRef.current = false;
    reconnectAttemptRef.current = 0;
    xtermInstance.current = new XTerm({
      allowProposedApi: true,
      theme: themes[validTheme as keyof typeof themes],
      fontFamily: '"JetBrains Mono Variable", monospace',
      fontSize: 12,
    });

    xtermInstance.current.open(terminalDiv.current as unknown as HTMLElement);
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    const unicode11Addon = new Unicode11Addon();
    const webLinksAddon = new WebLinksAddon();
    xtermInstance.current.loadAddon(fitAddon);
    if (isWebglSupported()) {
      const webglAddon = new WebglAddon();
      xtermInstance.current.loadAddon(webglAddon);
    }
    xtermInstance.current.loadAddon(unicode11Addon);
    xtermInstance.current.loadAddon(webLinksAddon);

    fitAddonRef.current.fit();

    // Hand read accessors to the parent. Reads go through xtermInstance.current
    // at call time, so the handle stays valid across reconnects (which replace
    // the XTerm instance) without the parent re-subscribing.
    onReady?.({
      getRecentLines: (n: number) => {
        const term = xtermInstance.current;
        if (!term) return [];
        const buffer = term.buffer.active;
        const end = buffer.baseY + buffer.cursorY;
        const start = Math.max(0, end - Math.max(0, n) * 2);
        const lines: string[] = [];
        for (let i = start; i <= end; i += 1) {
          const text = buffer.getLine(i)?.translateToString(true) ?? '';
          if (text.trim()) lines.push(text);
        }
        return lines.slice(-Math.max(0, n));
      },
      reconnect: reconnectSocket,
      getIdentity: () => ({ terminalId: terminalIdRef.current, connected: connectedRef.current }),
      closeTerminal,
    });

    xtermInstance.current.onTitleChange((title) => {
      onTitleChanged?.(title);
    });

    xtermInstance.current.onData((data) => {
      if (reconnectingRef.current) return;
      // An agent command owns the PTY input line while it runs; the operator's
      // keystrokes are dropped so they cannot interleave with it.
      if (agentCommandRef.current) return;
      markActivity();
      if (websocketInstance.current && websocketInstance.current.readyState === WebSocket.OPEN) {
        websocketInstance.current.send(JSON.stringify({
          type: "data",
          data: b64encode(data)
        }));
      }
    });

    connectWebSocket();
  }

  const connectWebSocket = () => {
    // A background reconnect skips resetTerminal, so clear any timers left over
    // from the previous connection — otherwise the old ping/idle loops stack up
    // and keep writing to a dead socket across each retry.
    if (pingLooper.current) {
      clearInterval(pingLooper.current);
      pingLooper.current = null;
    }
    if (idleTimerRef.current) {
      clearInterval(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    setConnecting(true);

    websocketInstance.current = new WebSocket(buildWebSocketUrl(ws));

    websocketInstance.current.onopen = () => {
      markActivity();
      pingLooper.current = window.setInterval(() => {
        if (websocketInstance.current && websocketInstance.current.readyState === WebSocket.OPEN) {
          websocketInstance.current.send(JSON.stringify({ type: "ping" }));
        }
      }, 5000);
      // Idle watchdog: tick every 30s, disconnect once no user input / server
      // output has arrived for IDLE_TIMEOUT_MS. Separate from the ping loop so
      // keep-alive traffic never counts as activity.
      idleTimerRef.current = window.setInterval(() => {
        if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
          disconnectIdle();
        }
      }, 30000);
    };

    websocketInstance.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'data') {
        markActivity();
        const decodedData = b64decode(data.data);
        xtermInstance.current?.write(decodedData);
      } else if (data.type === 'connected') {
        markActivity();
        const connectData = JSON.parse(data.data);
        terminalIdRef.current = String(connectData.terminal_id || '');
        onUserNameChanged?.(connectData.username, connectData.avatar_url || "");
        toast.success(t("common.terminal.connected"));
        setReconnectState(null);
        setConnecting(false);
        setConnected(true);
        everConnectedRef.current = true;
        // The session is truly up — restart the reconnect backoff from the top
        // so a subsequent drop doesn't inherit the previous storm's delay.
        reconnectAttemptRef.current = 0;
        xtermInstance.current?.focus();
        // Trigger resize after the DOM has updated.
        requestAnimationFrame(() => {
          handleResize();
        });
      } else if (data.type === 'resize') {
        const { col, row } = JSON.parse(data.data);
        xtermInstance.current?.resize(col, row);
      } else if (data.type === 'agent_command_start') {
        // The gateway is about to type an agent command into this PTY; lock
        // local stdin until it reports the command finished.
        try {
          const payload = JSON.parse(data.data || '{}');
          setAgentCommandRunning(true, String(payload.command || ''));
        } catch {
          setAgentCommandRunning(true, '');
        }
      } else if (data.type === 'agent_command_output') {
        // Output withheld during marker detection, flushed at command end.
        try {
          const payload = JSON.parse(data.data || '{}');
          if (payload.data) xtermInstance.current?.write(String(payload.data));
        } catch {
          // ignore malformed flush payload
        }
      } else if (data.type === 'agent_command_end') {
        setAgentCommandRunning(false, '');
      } else if (data.type === 'error') {
        toast.error(t("common.terminal.serverError", { message: data.data }));
      }
    };

    websocketInstance.current.onclose = (event) => {
      if (websocketInstance.current !== event.target) return;
      setConnecting(false);
      setConnected(false);
      terminalIdRef.current = '';
      // The PTY is gone, so any agent command against it is over; release the
      // local input lock so the operator is not stuck if the socket dropped
      // mid-command.
      if (agentCommandRef.current) setAgentCommandRunning(false, '');
      // Intentional teardown (unmount / idle / manual reconnect) sets
      // manualDisconnectRef and must not trigger a background retry. Auth or
      // permission closes (4401/4403) and a normal close (1000, e.g. the shell
      // exited) are not retryable either — surface the server's reason instead
      // of silently flipping to "未连接".
      if (manualDisconnectRef.current) return;
      if (isReconnectable(event.code) && everConnectedRef.current) {
        scheduleReconnect();
      } else {
        setReconnectState(null);
        if (event.reason) {
          xtermInstance.current?.writeln(`\r\n\x1b[31m${event.reason}\x1b[0m`);
        }
      }
    };

    websocketInstance.current.onerror = (event) => {
      if (websocketInstance.current !== event.target) return;
      setConnecting(false);
      setConnected(false);
      // Only toast the first failure of an episode. Subsequent background
      // retries surface progress via the reconnecting line in the terminal
      // instead of spamming toasts on every backoff tick.
      if (reconnectAttemptRef.current === 0 && !manualDisconnectRef.current) {
        toast.error(t("common.terminal.connectionError"));
      }
    };
  }

  React.useEffect(() => {
    if (signal > 0) {
      connectTerminal();
    }
    // Tear the session down on unmount (e.g. navigating back from the terminal
    // page). Without this the socket and ping loop outlive the component, the
    // server-side idle timeout never fires because pings keep arriving, and the
    // shell + PTY leak on the node host until its NodeConnect drops.
    return () => {
      resetTerminal();
    };
  }, [signal])

  return (
    <div
      className='relative h-full w-full overflow-hidden p-2 pr-0'
      style={{ backgroundColor: themes[validTheme as keyof typeof themes].background }}
    >
      <div ref={terminalDiv} className='h-full w-full' />
      {reconnectProgress ? (
        <div
          className='absolute inset-0 z-20 flex items-center justify-center bg-black/45 backdrop-blur-[1px]'
          role='status'
          aria-live='polite'
          aria-busy='true'
        >
          <div className='flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-lg border border-white/15 bg-black/75 px-5 py-4 text-white shadow-2xl'>
            <Spinner className='size-5 shrink-0' />
            <div className='min-w-0'>
              <div className='text-sm font-medium'>{t("common.terminal.reconnectingTitle")}</div>
              <div className='mt-1 text-xs text-white/70'>
                {t("common.terminal.reconnecting", reconnectProgress)}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
