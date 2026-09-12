import{aQ as ve,aR as Ne,aS as xe,aT as Te,aU as be,aV as Yt,aW as Pe,aM as Gt,_ as c,g as Re,s as $e,q as Be,p as He,a as qe,b as Xe,c as ft,d as bt,aX as Ge,aY as Ue,aZ as Ze,e as je,L as Qe,a_ as G,l as ot,a$ as ae,b0 as se,b1 as Ke,b2 as Je,b3 as tr,b4 as er,b5 as rr,b6 as ir,b7 as nr,b8 as oe,b9 as ce,ba as le,bb as ue,bc as de,k as ar,j as sr,z as or,u as cr,bd as lr}from"./index-CYrGC_gX.js";const ur=Math.PI/180,dr=180/Math.PI,It=18,we=.96422,_e=1,De=.82521,Ce=4/29,ht=6/29,Se=3*ht*ht,fr=ht*ht*ht;function Ee(t){if(t instanceof et)return new et(t.l,t.a,t.b,t.opacity);if(t instanceof it)return Me(t);t instanceof ve||(t=Ne(t));var e=zt(t.r),i=zt(t.g),a=zt(t.b),s=Ot((.2225045*e+.7168786*i+.0606169*a)/_e),d,u;return e===i&&i===a?d=u=s:(d=Ot((.4360747*e+.3850649*i+.1430804*a)/we),u=Ot((.0139322*e+.0971045*i+.7141733*a)/De)),new et(116*s-16,500*(d-s),200*(s-u),t.opacity)}function hr(t,e,i,a){return arguments.length===1?Ee(t):new et(t,e,i,a??1)}function et(t,e,i,a){this.l=+t,this.a=+e,this.b=+i,this.opacity=+a}xe(et,hr,Te(be,{brighter(t){return new et(this.l+It*(t??1),this.a,this.b,this.opacity)},darker(t){return new et(this.l-It*(t??1),this.a,this.b,this.opacity)},rgb(){var t=(this.l+16)/116,e=isNaN(this.a)?t:t+this.a/500,i=isNaN(this.b)?t:t-this.b/200;return e=we*Wt(e),t=_e*Wt(t),i=De*Wt(i),new ve(Vt(3.1338561*e-1.6168667*t-.4906146*i),Vt(-.9787684*e+1.9161415*t+.033454*i),Vt(.0719453*e-.2289914*t+1.4052427*i),this.opacity)}}));function Ot(t){return t>fr?Math.pow(t,1/3):t/Se+Ce}function Wt(t){return t>ht?t*t*t:Se*(t-Ce)}function Vt(t){return 255*(t<=.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055)}function zt(t){return(t/=255)<=.04045?t/12.92:Math.pow((t+.055)/1.055,2.4)}function mr(t){if(t instanceof it)return new it(t.h,t.c,t.l,t.opacity);if(t instanceof et||(t=Ee(t)),t.a===0&&t.b===0)return new it(NaN,0<t.l&&t.l<100?0:NaN,t.l,t.opacity);var e=Math.atan2(t.b,t.a)*dr;return new it(e<0?e+360:e,Math.sqrt(t.a*t.a+t.b*t.b),t.l,t.opacity)}function Rt(t,e,i,a){return arguments.length===1?mr(t):new it(t,e,i,a??1)}function it(t,e,i,a){this.h=+t,this.c=+e,this.l=+i,this.opacity=+a}function Me(t){if(isNaN(t.h))return new et(t.l,0,0,t.opacity);var e=t.h*ur;return new et(t.l,Math.cos(e)*t.c,Math.sin(e)*t.c,t.opacity)}xe(it,Rt,Te(be,{brighter(t){return new it(this.h,this.c,this.l+It*(t??1),this.opacity)},darker(t){return new it(this.h,this.c,this.l-It*(t??1),this.opacity)},rgb(){return Me(this).rgb()}}));function kr(t){return function(e,i){var a=t((e=Rt(e)).h,(i=Rt(i)).h),s=Yt(e.c,i.c),d=Yt(e.l,i.l),u=Yt(e.opacity,i.opacity);return function(g){return e.h=a(g),e.c=s(g),e.l=d(g),e.opacity=u(g),e+""}}}const yr=kr(Pe);function gr(t){return t}var _t=1,Nt=2,$t=3,wt=4,fe=1e-6;function pr(t){return"translate("+t+",0)"}function vr(t){return"translate(0,"+t+")"}function xr(t){return e=>+t(e)}function Tr(t,e){return e=Math.max(0,t.bandwidth()-e*2)/2,t.round()&&(e=Math.round(e)),i=>+t(i)+e}function br(){return!this.__axis}function Ie(t,e){var i=[],a=null,s=null,d=6,u=6,g=3,D=typeof window<"u"&&window.devicePixelRatio>1?0:.5,E=t===_t||t===wt?-1:1,p=t===wt||t===Nt?"x":"y",L=t===_t||t===$t?pr:vr;function C(w){var H=a??(e.ticks?e.ticks.apply(e,i):e.domain()),I=s??(e.tickFormat?e.tickFormat.apply(e,i):gr),_=Math.max(d,0)+g,M=e.range(),O=+M[0]+D,W=+M[M.length-1]+D,N=(e.bandwidth?Tr:xr)(e.copy(),D),P=w.selection?w.selection():w,q=P.selectAll(".domain").data([null]),z=P.selectAll(".tick").data(H,e).order(),R=z.exit(),k=z.enter().append("g").attr("class","tick"),T=z.select("line"),b=z.select("text");q=q.merge(q.enter().insert("path",".tick").attr("class","domain").attr("stroke","currentColor")),z=z.merge(k),T=T.merge(k.append("line").attr("stroke","currentColor").attr(p+"2",E*d)),b=b.merge(k.append("text").attr("fill","currentColor").attr(p,E*_).attr("dy",t===_t?"0em":t===$t?"0.71em":"0.32em")),w!==P&&(q=q.transition(w),z=z.transition(w),T=T.transition(w),b=b.transition(w),R=R.transition(w).attr("opacity",fe).attr("transform",function(y){return isFinite(y=N(y))?L(y+D):this.getAttribute("transform")}),k.attr("opacity",fe).attr("transform",function(y){var m=this.parentNode.__axis;return L((m&&isFinite(m=m(y))?m:N(y))+D)})),R.remove(),q.attr("d",t===wt||t===Nt?u?"M"+E*u+","+O+"H"+D+"V"+W+"H"+E*u:"M"+D+","+O+"V"+W:u?"M"+O+","+E*u+"V"+D+"H"+W+"V"+E*u:"M"+O+","+D+"H"+W),z.attr("opacity",1).attr("transform",function(y){return L(N(y)+D)}),T.attr(p+"2",E*d),b.attr(p,E*_).text(I),P.filter(br).attr("fill","none").attr("font-size",10).attr("font-family","sans-serif").attr("text-anchor",t===Nt?"start":t===wt?"end":"middle"),P.each(function(){this.__axis=N})}return C.scale=function(w){return arguments.length?(e=w,C):e},C.ticks=function(){return i=Array.from(arguments),C},C.tickArguments=function(w){return arguments.length?(i=w==null?[]:Array.from(w),C):i.slice()},C.tickValues=function(w){return arguments.length?(a=w==null?null:Array.from(w),C):a&&a.slice()},C.tickFormat=function(w){return arguments.length?(s=w,C):s},C.tickSize=function(w){return arguments.length?(d=u=+w,C):d},C.tickSizeInner=function(w){return arguments.length?(d=+w,C):d},C.tickSizeOuter=function(w){return arguments.length?(u=+w,C):u},C.tickPadding=function(w){return arguments.length?(g=+w,C):g},C.offset=function(w){return arguments.length?(D=+w,C):D},C}function wr(t){return Ie(_t,t)}function _r(t){return Ie($t,t)}var Dt={exports:{}},Dr=Dt.exports,he;function Cr(){return he||(he=1,(function(t,e){(function(i,a){t.exports=a()})(Dr,(function(){return function(i,a){var s=a.prototype,d=s.format;s.format=function(u){var g=this,D=this.$locale();if(!this.isValid())return d.bind(this)(u);var E=this.$utils(),p=(u||"YYYY-MM-DDTHH:mm:ssZ").replace(/\[([^\]]+)]|Q|wo|ww|w|WW|W|zzz|z|gggg|GGGG|Do|X|x|k{1,2}|S/g,(function(L){switch(L){case"Q":return Math.ceil((g.$M+1)/3);case"Do":return D.ordinal(g.$D);case"gggg":return g.weekYear();case"GGGG":return g.isoWeekYear();case"wo":return D.ordinal(g.week(),"W");case"w":case"ww":return E.s(g.week(),L==="w"?1:2,"0");case"W":case"WW":return E.s(g.isoWeek(),L==="W"?1:2,"0");case"k":case"kk":return E.s(String(g.$H===0?24:g.$H),L==="k"?1:2,"0");case"X":return Math.floor(g.$d.getTime()/1e3);case"x":return g.$d.getTime();case"z":return"["+g.offsetName()+"]";case"zzz":return"["+g.offsetName("long")+"]";default:return L}}));return d.bind(this)(p)}}}))})(Dt)),Dt.exports}var Sr=Cr();const Er=Gt(Sr);var Ct={exports:{}},Mr=Ct.exports,me;function Ir(){return me||(me=1,(function(t,e){(function(i,a){t.exports=a()})(Mr,(function(){var i={LTS:"h:mm:ss A",LT:"h:mm A",L:"MM/DD/YYYY",LL:"MMMM D, YYYY",LLL:"MMMM D, YYYY h:mm A",LLLL:"dddd, MMMM D, YYYY h:mm A"},a=/(\[[^[]*\])|([-_:/.,()\s]+)|(A|a|Q|YYYY|YY?|ww?|MM?M?M?|Do|DD?|hh?|HH?|mm?|ss?|S{1,3}|z|ZZ?)/g,s=/\d/,d=/\d\d/,u=/\d\d?/,g=/\d*[^-_:/,()\s\d]+/,D={},E=function(_){return(_=+_)+(_>68?1900:2e3)},p=function(_){return function(M){this[_]=+M}},L=[/[+-]\d\d:?(\d\d)?|Z/,function(_){(this.zone||(this.zone={})).offset=(function(M){if(!M||M==="Z")return 0;var O=M.match(/([+-]|\d\d)/g),W=60*O[1]+(+O[2]||0);return W===0?0:O[0]==="+"?-W:W})(_)}],C=function(_){var M=D[_];return M&&(M.indexOf?M:M.s.concat(M.f))},w=function(_,M){var O,W=D.meridiem;if(W){for(var N=1;N<=24;N+=1)if(_.indexOf(W(N,0,M))>-1){O=N>12;break}}else O=_===(M?"pm":"PM");return O},H={A:[g,function(_){this.afternoon=w(_,!1)}],a:[g,function(_){this.afternoon=w(_,!0)}],Q:[s,function(_){this.month=3*(_-1)+1}],S:[s,function(_){this.milliseconds=100*+_}],SS:[d,function(_){this.milliseconds=10*+_}],SSS:[/\d{3}/,function(_){this.milliseconds=+_}],s:[u,p("seconds")],ss:[u,p("seconds")],m:[u,p("minutes")],mm:[u,p("minutes")],H:[u,p("hours")],h:[u,p("hours")],HH:[u,p("hours")],hh:[u,p("hours")],D:[u,p("day")],DD:[d,p("day")],Do:[g,function(_){var M=D.ordinal,O=_.match(/\d+/);if(this.day=O[0],M)for(var W=1;W<=31;W+=1)M(W).replace(/\[|\]/g,"")===_&&(this.day=W)}],w:[u,p("week")],ww:[d,p("week")],M:[u,p("month")],MM:[d,p("month")],MMM:[g,function(_){var M=C("months"),O=(C("monthsShort")||M.map((function(W){return W.slice(0,3)}))).indexOf(_)+1;if(O<1)throw new Error;this.month=O%12||O}],MMMM:[g,function(_){var M=C("months").indexOf(_)+1;if(M<1)throw new Error;this.month=M%12||M}],Y:[/[+-]?\d+/,p("year")],YY:[d,function(_){this.year=E(_)}],YYYY:[/\d{4}/,p("year")],Z:L,ZZ:L};function I(_){var M,O;M=_,O=D&&D.formats;for(var W=(_=M.replace(/(\[[^\]]+])|(LTS?|l{1,4}|L{1,4})/g,(function(T,b,y){var m=y&&y.toUpperCase();return b||O[y]||i[y]||O[m].replace(/(\[[^\]]+])|(MMMM|MM|DD|dddd)/g,(function(o,l,f){return l||f.slice(1)}))}))).match(a),N=W.length,P=0;P<N;P+=1){var q=W[P],z=H[q],R=z&&z[0],k=z&&z[1];W[P]=k?{regex:R,parser:k}:q.replace(/^\[|\]$/g,"")}return function(T){for(var b={},y=0,m=0;y<N;y+=1){var o=W[y];if(typeof o=="string")m+=o.length;else{var l=o.regex,f=o.parser,h=T.slice(m),x=l.exec(h)[0];f.call(b,x),T=T.replace(x,"")}}return(function(n){var V=n.afternoon;if(V!==void 0){var r=n.hours;V?r<12&&(n.hours+=12):r===12&&(n.hours=0),delete n.afternoon}})(b),b}}return function(_,M,O){O.p.customParseFormat=!0,_&&_.parseTwoDigitYear&&(E=_.parseTwoDigitYear);var W=M.prototype,N=W.parse;W.parse=function(P){var q=P.date,z=P.utc,R=P.args;this.$u=z;var k=R[1];if(typeof k=="string"){var T=R[2]===!0,b=R[3]===!0,y=T||b,m=R[2];b&&(m=R[2]),D=this.$locale(),!T&&m&&(D=O.Ls[m]),this.$d=(function(h,x,n,V){try{if(["x","X"].indexOf(x)>-1)return new Date((x==="X"?1e3:1)*h);var r=I(x)(h),v=r.year,Y=r.month,F=r.day,A=r.hours,X=r.minutes,S=r.seconds,Q=r.milliseconds,nt=r.zone,lt=r.week,yt=new Date,gt=F||(v||Y?1:yt.getDate()),ut=v||yt.getFullYear(),$=0;v&&!Y||($=Y>0?Y-1:yt.getMonth());var j,U=A||0,st=X||0,K=S||0,at=Q||0;return nt?new Date(Date.UTC(ut,$,gt,U,st,K,at+60*nt.offset*1e3)):n?new Date(Date.UTC(ut,$,gt,U,st,K,at)):(j=new Date(ut,$,gt,U,st,K,at),lt&&(j=V(j).week(lt).toDate()),j)}catch{return new Date("")}})(q,k,z,O),this.init(),m&&m!==!0&&(this.$L=this.locale(m).$L),y&&q!=this.format(k)&&(this.$d=new Date("")),D={}}else if(k instanceof Array)for(var o=k.length,l=1;l<=o;l+=1){R[1]=k[l-1];var f=O.apply(this,R);if(f.isValid()){this.$d=f.$d,this.$L=f.$L,this.init();break}l===o&&(this.$d=new Date(""))}else N.call(this,P)}}}))})(Ct)),Ct.exports}var Ar=Ir();const Fr=Gt(Ar);var St={exports:{}},Lr=St.exports,ke;function Yr(){return ke||(ke=1,(function(t,e){(function(i,a){t.exports=a()})(Lr,(function(){var i="day";return function(a,s,d){var u=function(E){return E.add(4-E.isoWeekday(),i)},g=s.prototype;g.isoWeekYear=function(){return u(this).year()},g.isoWeek=function(E){if(!this.$utils().u(E))return this.add(7*(E-this.isoWeek()),i);var p,L,C,w,H=u(this),I=(p=this.isoWeekYear(),L=this.$u,C=(L?d.utc:d)().year(p).startOf("year"),w=4-C.isoWeekday(),C.isoWeekday()>4&&(w+=7),C.add(w,i));return H.diff(I,"week")+1},g.isoWeekday=function(E){return this.$utils().u(E)?this.day()||7:this.day(this.day()%7?E:E-7)};var D=g.startOf;g.startOf=function(E,p){var L=this.$utils(),C=!!L.u(p)||p;return L.p(E)==="isoweek"?C?this.date(this.date()-(this.isoWeekday()-1)).startOf("day"):this.date(this.date()-1-(this.isoWeekday()-1)+7).endOf("day"):D.bind(this)(E,p)}}}))})(St)),St.exports}var Or=Yr();const Wr=Gt(Or);var Bt=(function(){var t=c(function(m,o,l,f){for(l=l||{},f=m.length;f--;l[m[f]]=o);return l},"o"),e=[6,8,10,12,13,14,15,16,17,18,20,21,22,23,24,25,26,27,28,29,30,31,33,35,36,38,40],i=[1,26],a=[1,27],s=[1,28],d=[1,29],u=[1,30],g=[1,31],D=[1,32],E=[1,33],p=[1,34],L=[1,9],C=[1,10],w=[1,11],H=[1,12],I=[1,13],_=[1,14],M=[1,15],O=[1,16],W=[1,19],N=[1,20],P=[1,21],q=[1,22],z=[1,23],R=[1,25],k=[1,35],T={trace:c(function(){},"trace"),yy:{},symbols_:{error:2,start:3,gantt:4,document:5,EOF:6,line:7,SPACE:8,statement:9,NL:10,weekday:11,weekday_monday:12,weekday_tuesday:13,weekday_wednesday:14,weekday_thursday:15,weekday_friday:16,weekday_saturday:17,weekday_sunday:18,weekend:19,weekend_friday:20,weekend_saturday:21,dateFormat:22,inclusiveEndDates:23,topAxis:24,axisFormat:25,tickInterval:26,excludes:27,includes:28,todayMarker:29,title:30,acc_title:31,acc_title_value:32,acc_descr:33,acc_descr_value:34,acc_descr_multiline_value:35,section:36,clickStatement:37,taskTxt:38,taskData:39,click:40,callbackname:41,callbackargs:42,href:43,clickStatementDebug:44,$accept:0,$end:1},terminals_:{2:"error",4:"gantt",6:"EOF",8:"SPACE",10:"NL",12:"weekday_monday",13:"weekday_tuesday",14:"weekday_wednesday",15:"weekday_thursday",16:"weekday_friday",17:"weekday_saturday",18:"weekday_sunday",20:"weekend_friday",21:"weekend_saturday",22:"dateFormat",23:"inclusiveEndDates",24:"topAxis",25:"axisFormat",26:"tickInterval",27:"excludes",28:"includes",29:"todayMarker",30:"title",31:"acc_title",32:"acc_title_value",33:"acc_descr",34:"acc_descr_value",35:"acc_descr_multiline_value",36:"section",38:"taskTxt",39:"taskData",40:"click",41:"callbackname",42:"callbackargs",43:"href"},productions_:[0,[3,3],[5,0],[5,2],[7,2],[7,1],[7,1],[7,1],[11,1],[11,1],[11,1],[11,1],[11,1],[11,1],[11,1],[19,1],[19,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,2],[9,2],[9,1],[9,1],[9,1],[9,2],[37,2],[37,3],[37,3],[37,4],[37,3],[37,4],[37,2],[44,2],[44,3],[44,3],[44,4],[44,3],[44,4],[44,2]],performAction:c(function(o,l,f,h,x,n,V){var r=n.length-1;switch(x){case 1:return n[r-1];case 2:this.$=[];break;case 3:n[r-1].push(n[r]),this.$=n[r-1];break;case 4:case 5:this.$=n[r];break;case 6:case 7:this.$=[];break;case 8:h.setWeekday("monday");break;case 9:h.setWeekday("tuesday");break;case 10:h.setWeekday("wednesday");break;case 11:h.setWeekday("thursday");break;case 12:h.setWeekday("friday");break;case 13:h.setWeekday("saturday");break;case 14:h.setWeekday("sunday");break;case 15:h.setWeekend("friday");break;case 16:h.setWeekend("saturday");break;case 17:h.setDateFormat(n[r].substr(11)),this.$=n[r].substr(11);break;case 18:h.enableInclusiveEndDates(),this.$=n[r].substr(18);break;case 19:h.TopAxis(),this.$=n[r].substr(8);break;case 20:h.setAxisFormat(n[r].substr(11)),this.$=n[r].substr(11);break;case 21:h.setTickInterval(n[r].substr(13)),this.$=n[r].substr(13);break;case 22:h.setExcludes(n[r].substr(9)),this.$=n[r].substr(9);break;case 23:h.setIncludes(n[r].substr(9)),this.$=n[r].substr(9);break;case 24:h.setTodayMarker(n[r].substr(12)),this.$=n[r].substr(12);break;case 27:h.setDiagramTitle(n[r].substr(6)),this.$=n[r].substr(6);break;case 28:this.$=n[r].trim(),h.setAccTitle(this.$);break;case 29:case 30:this.$=n[r].trim(),h.setAccDescription(this.$);break;case 31:h.addSection(n[r].substr(8)),this.$=n[r].substr(8);break;case 33:h.addTask(n[r-1],n[r]),this.$="task";break;case 34:this.$=n[r-1],h.setClickEvent(n[r-1],n[r],null);break;case 35:this.$=n[r-2],h.setClickEvent(n[r-2],n[r-1],n[r]);break;case 36:this.$=n[r-2],h.setClickEvent(n[r-2],n[r-1],null),h.setLink(n[r-2],n[r]);break;case 37:this.$=n[r-3],h.setClickEvent(n[r-3],n[r-2],n[r-1]),h.setLink(n[r-3],n[r]);break;case 38:this.$=n[r-2],h.setClickEvent(n[r-2],n[r],null),h.setLink(n[r-2],n[r-1]);break;case 39:this.$=n[r-3],h.setClickEvent(n[r-3],n[r-1],n[r]),h.setLink(n[r-3],n[r-2]);break;case 40:this.$=n[r-1],h.setLink(n[r-1],n[r]);break;case 41:case 47:this.$=n[r-1]+" "+n[r];break;case 42:case 43:case 45:this.$=n[r-2]+" "+n[r-1]+" "+n[r];break;case 44:case 46:this.$=n[r-3]+" "+n[r-2]+" "+n[r-1]+" "+n[r];break}},"anonymous"),table:[{3:1,4:[1,2]},{1:[3]},t(e,[2,2],{5:3}),{6:[1,4],7:5,8:[1,6],9:7,10:[1,8],11:17,12:i,13:a,14:s,15:d,16:u,17:g,18:D,19:18,20:E,21:p,22:L,23:C,24:w,25:H,26:I,27:_,28:M,29:O,30:W,31:N,33:P,35:q,36:z,37:24,38:R,40:k},t(e,[2,7],{1:[2,1]}),t(e,[2,3]),{9:36,11:17,12:i,13:a,14:s,15:d,16:u,17:g,18:D,19:18,20:E,21:p,22:L,23:C,24:w,25:H,26:I,27:_,28:M,29:O,30:W,31:N,33:P,35:q,36:z,37:24,38:R,40:k},t(e,[2,5]),t(e,[2,6]),t(e,[2,17]),t(e,[2,18]),t(e,[2,19]),t(e,[2,20]),t(e,[2,21]),t(e,[2,22]),t(e,[2,23]),t(e,[2,24]),t(e,[2,25]),t(e,[2,26]),t(e,[2,27]),{32:[1,37]},{34:[1,38]},t(e,[2,30]),t(e,[2,31]),t(e,[2,32]),{39:[1,39]},t(e,[2,8]),t(e,[2,9]),t(e,[2,10]),t(e,[2,11]),t(e,[2,12]),t(e,[2,13]),t(e,[2,14]),t(e,[2,15]),t(e,[2,16]),{41:[1,40],43:[1,41]},t(e,[2,4]),t(e,[2,28]),t(e,[2,29]),t(e,[2,33]),t(e,[2,34],{42:[1,42],43:[1,43]}),t(e,[2,40],{41:[1,44]}),t(e,[2,35],{43:[1,45]}),t(e,[2,36]),t(e,[2,38],{42:[1,46]}),t(e,[2,37]),t(e,[2,39])],defaultActions:{},parseError:c(function(o,l){if(l.recoverable)this.trace(o);else{var f=new Error(o);throw f.hash=l,f}},"parseError"),parse:c(function(o){var l=this,f=[0],h=[],x=[null],n=[],V=this.table,r="",v=0,Y=0,F=2,A=1,X=n.slice.call(arguments,1),S=Object.create(this.lexer),Q={yy:{}};for(var nt in this.yy)Object.prototype.hasOwnProperty.call(this.yy,nt)&&(Q.yy[nt]=this.yy[nt]);S.setInput(o,Q.yy),Q.yy.lexer=S,Q.yy.parser=this,typeof S.yylloc>"u"&&(S.yylloc={});var lt=S.yylloc;n.push(lt);var yt=S.options&&S.options.ranges;typeof Q.yy.parseError=="function"?this.parseError=Q.yy.parseError:this.parseError=Object.getPrototypeOf(this).parseError;function gt(Z){f.length=f.length-2*Z,x.length=x.length-Z,n.length=n.length-Z}c(gt,"popStack");function ut(){var Z;return Z=h.pop()||S.lex()||A,typeof Z!="number"&&(Z instanceof Array&&(h=Z,Z=h.pop()),Z=l.symbols_[Z]||Z),Z}c(ut,"lex");for(var $,j,U,st,K={},at,J,ne,Tt;;){if(j=f[f.length-1],this.defaultActions[j]?U=this.defaultActions[j]:(($===null||typeof $>"u")&&($=ut()),U=V[j]&&V[j][$]),typeof U>"u"||!U.length||!U[0]){var Lt="";Tt=[];for(at in V[j])this.terminals_[at]&&at>F&&Tt.push("'"+this.terminals_[at]+"'");S.showPosition?Lt="Parse error on line "+(v+1)+`:
`+S.showPosition()+`
Expecting `+Tt.join(", ")+", got '"+(this.terminals_[$]||$)+"'":Lt="Parse error on line "+(v+1)+": Unexpected "+($==A?"end of input":"'"+(this.terminals_[$]||$)+"'"),this.parseError(Lt,{text:S.match,token:this.terminals_[$]||$,line:S.yylineno,loc:lt,expected:Tt})}if(U[0]instanceof Array&&U.length>1)throw new Error("Parse Error: multiple actions possible at state: "+j+", token: "+$);switch(U[0]){case 1:f.push($),x.push(S.yytext),n.push(S.yylloc),f.push(U[1]),$=null,Y=S.yyleng,r=S.yytext,v=S.yylineno,lt=S.yylloc;break;case 2:if(J=this.productions_[U[1]][1],K.$=x[x.length-J],K._$={first_line:n[n.length-(J||1)].first_line,last_line:n[n.length-1].last_line,first_column:n[n.length-(J||1)].first_column,last_column:n[n.length-1].last_column},yt&&(K._$.range=[n[n.length-(J||1)].range[0],n[n.length-1].range[1]]),st=this.performAction.apply(K,[r,Y,v,Q.yy,U[1],x,n].concat(X)),typeof st<"u")return st;J&&(f=f.slice(0,-1*J*2),x=x.slice(0,-1*J),n=n.slice(0,-1*J)),f.push(this.productions_[U[1]][0]),x.push(K.$),n.push(K._$),ne=V[f[f.length-2]][f[f.length-1]],f.push(ne);break;case 3:return!0}}return!0},"parse")},b=(function(){var m={EOF:1,parseError:c(function(l,f){if(this.yy.parser)this.yy.parser.parseError(l,f);else throw new Error(l)},"parseError"),setInput:c(function(o,l){return this.yy=l||this.yy||{},this._input=o,this._more=this._backtrack=this.done=!1,this.yylineno=this.yyleng=0,this.yytext=this.matched=this.match="",this.conditionStack=["INITIAL"],this.yylloc={first_line:1,first_column:0,last_line:1,last_column:0},this.options.ranges&&(this.yylloc.range=[0,0]),this.offset=0,this},"setInput"),input:c(function(){var o=this._input[0];this.yytext+=o,this.yyleng++,this.offset++,this.match+=o,this.matched+=o;var l=o.match(/(?:\r\n?|\n).*/g);return l?(this.yylineno++,this.yylloc.last_line++):this.yylloc.last_column++,this.options.ranges&&this.yylloc.range[1]++,this._input=this._input.slice(1),o},"input"),unput:c(function(o){var l=o.length,f=o.split(/(?:\r\n?|\n)/g);this._input=o+this._input,this.yytext=this.yytext.substr(0,this.yytext.length-l),this.offset-=l;var h=this.match.split(/(?:\r\n?|\n)/g);this.match=this.match.substr(0,this.match.length-1),this.matched=this.matched.substr(0,this.matched.length-1),f.length-1&&(this.yylineno-=f.length-1);var x=this.yylloc.range;return this.yylloc={first_line:this.yylloc.first_line,last_line:this.yylineno+1,first_column:this.yylloc.first_column,last_column:f?(f.length===h.length?this.yylloc.first_column:0)+h[h.length-f.length].length-f[0].length:this.yylloc.first_column-l},this.options.ranges&&(this.yylloc.range=[x[0],x[0]+this.yyleng-l]),this.yyleng=this.yytext.length,this},"unput"),more:c(function(){return this._more=!0,this},"more"),reject:c(function(){if(this.options.backtrack_lexer)this._backtrack=!0;else return this.parseError("Lexical error on line "+(this.yylineno+1)+`. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).
`+this.showPosition(),{text:"",token:null,line:this.yylineno});return this},"reject"),less:c(function(o){this.unput(this.match.slice(o))},"less"),pastInput:c(function(){var o=this.matched.substr(0,this.matched.length-this.match.length);return(o.length>20?"...":"")+o.substr(-20).replace(/\n/g,"")},"pastInput"),upcomingInput:c(function(){var o=this.match;return o.length<20&&(o+=this._input.substr(0,20-o.length)),(o.substr(0,20)+(o.length>20?"...":"")).replace(/\n/g,"")},"upcomingInput"),showPosition:c(function(){var o=this.pastInput(),l=new Array(o.length+1).join("-");return o+this.upcomingInput()+`
`+l+"^"},"showPosition"),test_match:c(function(o,l){var f,h,x;if(this.options.backtrack_lexer&&(x={yylineno:this.yylineno,yylloc:{first_line:this.yylloc.first_line,last_line:this.last_line,first_column:this.yylloc.first_column,last_column:this.yylloc.last_column},yytext:this.yytext,match:this.match,matches:this.matches,matched:this.matched,yyleng:this.yyleng,offset:this.offset,_more:this._more,_input:this._input,yy:this.yy,conditionStack:this.conditionStack.slice(0),done:this.done},this.options.ranges&&(x.yylloc.range=this.yylloc.range.slice(0))),h=o[0].match(/(?:\r\n?|\n).*/g),h&&(this.yylineno+=h.length),this.yylloc={first_line:this.yylloc.last_line,last_line:this.yylineno+1,first_column:this.yylloc.last_column,last_column:h?h[h.length-1].length-h[h.length-1].match(/\r?\n?/)[0].length:this.yylloc.last_column+o[0].length},this.yytext+=o[0],this.match+=o[0],this.matches=o,this.yyleng=this.yytext.length,this.options.ranges&&(this.yylloc.range=[this.offset,this.offset+=this.yyleng]),this._more=!1,this._backtrack=!1,this._input=this._input.slice(o[0].length),this.matched+=o[0],f=this.performAction.call(this,this.yy,this,l,this.conditionStack[this.conditionStack.length-1]),this.done&&this._input&&(this.done=!1),f)return f;if(this._backtrack){for(var n in x)this[n]=x[n];return!1}return!1},"test_match"),next:c(function(){if(this.done)return this.EOF;this._input||(this.done=!0);var o,l,f,h;this._more||(this.yytext="",this.match="");for(var x=this._currentRules(),n=0;n<x.length;n++)if(f=this._input.match(this.rules[x[n]]),f&&(!l||f[0].length>l[0].length)){if(l=f,h=n,this.options.backtrack_lexer){if(o=this.test_match(f,x[n]),o!==!1)return o;if(this._backtrack){l=!1;continue}else return!1}else if(!this.options.flex)break}return l?(o=this.test_match(l,x[h]),o!==!1?o:!1):this._input===""?this.EOF:this.parseError("Lexical error on line "+(this.yylineno+1)+`. Unrecognized text.
`+this.showPosition(),{text:"",token:null,line:this.yylineno})},"next"),lex:c(function(){var l=this.next();return l||this.lex()},"lex"),begin:c(function(l){this.conditionStack.push(l)},"begin"),popState:c(function(){var l=this.conditionStack.length-1;return l>0?this.conditionStack.pop():this.conditionStack[0]},"popState"),_currentRules:c(function(){return this.conditionStack.length&&this.conditionStack[this.conditionStack.length-1]?this.conditions[this.conditionStack[this.conditionStack.length-1]].rules:this.conditions.INITIAL.rules},"_currentRules"),topState:c(function(l){return l=this.conditionStack.length-1-Math.abs(l||0),l>=0?this.conditionStack[l]:"INITIAL"},"topState"),pushState:c(function(l){this.begin(l)},"pushState"),stateStackSize:c(function(){return this.conditionStack.length},"stateStackSize"),options:{"case-insensitive":!0},performAction:c(function(l,f,h,x){switch(h){case 0:return this.begin("open_directive"),"open_directive";case 1:return this.begin("acc_title"),31;case 2:return this.popState(),"acc_title_value";case 3:return this.begin("acc_descr"),33;case 4:return this.popState(),"acc_descr_value";case 5:this.begin("acc_descr_multiline");break;case 6:this.popState();break;case 7:return"acc_descr_multiline_value";case 8:break;case 9:break;case 10:break;case 11:return 10;case 12:break;case 13:break;case 14:this.begin("href");break;case 15:this.popState();break;case 16:return 43;case 17:this.begin("callbackname");break;case 18:this.popState();break;case 19:this.popState(),this.begin("callbackargs");break;case 20:return 41;case 21:this.popState();break;case 22:return 42;case 23:this.begin("click");break;case 24:this.popState();break;case 25:return 40;case 26:return 4;case 27:return 22;case 28:return 23;case 29:return 24;case 30:return 25;case 31:return 26;case 32:return 28;case 33:return 27;case 34:return 29;case 35:return 12;case 36:return 13;case 37:return 14;case 38:return 15;case 39:return 16;case 40:return 17;case 41:return 18;case 42:return 20;case 43:return 21;case 44:return"date";case 45:return 30;case 46:return"accDescription";case 47:return 36;case 48:return 38;case 49:return 39;case 50:return":";case 51:return 6;case 52:return"INVALID"}},"anonymous"),rules:[/^(?:%%\{)/i,/^(?:accTitle\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*\{\s*)/i,/^(?:[\}])/i,/^(?:[^\}]*)/i,/^(?:%%(?!\{)*[^\n]*)/i,/^(?:[^\}]%%*[^\n]*)/i,/^(?:%%*[^\n]*[\n]*)/i,/^(?:[\n]+)/i,/^(?:\s+)/i,/^(?:%[^\n]*)/i,/^(?:href[\s]+["])/i,/^(?:["])/i,/^(?:[^"]*)/i,/^(?:call[\s]+)/i,/^(?:\([\s]*\))/i,/^(?:\()/i,/^(?:[^(]*)/i,/^(?:\))/i,/^(?:[^)]*)/i,/^(?:click[\s]+)/i,/^(?:[\s\n])/i,/^(?:[^\s\n]*)/i,/^(?:gantt\b)/i,/^(?:dateFormat\s[^#\n;]+)/i,/^(?:inclusiveEndDates\b)/i,/^(?:topAxis\b)/i,/^(?:axisFormat\s[^#\n;]+)/i,/^(?:tickInterval\s[^#\n;]+)/i,/^(?:includes\s[^#\n;]+)/i,/^(?:excludes\s[^#\n;]+)/i,/^(?:todayMarker\s[^\n;]+)/i,/^(?:weekday\s+monday\b)/i,/^(?:weekday\s+tuesday\b)/i,/^(?:weekday\s+wednesday\b)/i,/^(?:weekday\s+thursday\b)/i,/^(?:weekday\s+friday\b)/i,/^(?:weekday\s+saturday\b)/i,/^(?:weekday\s+sunday\b)/i,/^(?:weekend\s+friday\b)/i,/^(?:weekend\s+saturday\b)/i,/^(?:\d\d\d\d-\d\d-\d\d\b)/i,/^(?:title\s[^\n]+)/i,/^(?:accDescription\s[^#\n;]+)/i,/^(?:section\s[^\n]+)/i,/^(?:[^:\n]+)/i,/^(?::[^#\n;]+)/i,/^(?::)/i,/^(?:$)/i,/^(?:.)/i],conditions:{acc_descr_multiline:{rules:[6,7],inclusive:!1},acc_descr:{rules:[4],inclusive:!1},acc_title:{rules:[2],inclusive:!1},callbackargs:{rules:[21,22],inclusive:!1},callbackname:{rules:[18,19,20],inclusive:!1},href:{rules:[15,16],inclusive:!1},click:{rules:[24,25],inclusive:!1},INITIAL:{rules:[0,1,3,5,8,9,10,11,12,13,14,17,23,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52],inclusive:!0}}};return m})();T.lexer=b;function y(){this.yy={}}return c(y,"Parser"),y.prototype=T,T.Parser=y,new y})();Bt.parser=Bt;var Vr=Bt;G.extend(Wr);G.extend(Fr);G.extend(Er);var ye={friday:5,saturday:6},tt="",Ut="",Zt=void 0,jt="",pt=[],vt=[],Qt=new Map,Kt=[],At=[],kt="",Jt="",Ae=["active","done","crit","milestone","vert"],te=[],dt="",xt=!1,ee=!1,re="sunday",Ft="saturday",Ht=0,zr=c(function(){Kt=[],At=[],kt="",te=[],Et=0,Xt=void 0,Mt=void 0,B=[],tt="",Ut="",Jt="",Zt=void 0,jt="",pt=[],vt=[],xt=!1,ee=!1,Ht=0,Qt=new Map,dt="",or(),re="sunday",Ft="saturday"},"clear"),Nr=c(function(t){dt=t},"setDiagramId"),Pr=c(function(t){Ut=t},"setAxisFormat"),Rr=c(function(){return Ut},"getAxisFormat"),$r=c(function(t){Zt=t},"setTickInterval"),Br=c(function(){return Zt},"getTickInterval"),Hr=c(function(t){jt=t},"setTodayMarker"),qr=c(function(){return jt},"getTodayMarker"),Xr=c(function(t){tt=t},"setDateFormat"),Gr=c(function(){xt=!0},"enableInclusiveEndDates"),Ur=c(function(){return xt},"endDatesAreInclusive"),Zr=c(function(){ee=!0},"enableTopAxis"),jr=c(function(){return ee},"topAxisEnabled"),Qr=c(function(t){Jt=t},"setDisplayMode"),Kr=c(function(){return Jt},"getDisplayMode"),Jr=c(function(){return tt},"getDateFormat"),ti=c(function(t){pt=t.toLowerCase().split(/[\s,]+/)},"setIncludes"),ei=c(function(){return pt},"getIncludes"),ri=c(function(t){vt=t.toLowerCase().split(/[\s,]+/)},"setExcludes"),ii=c(function(){return vt},"getExcludes"),ni=c(function(){return Qt},"getLinks"),ai=c(function(t){kt=t,Kt.push(t)},"addSection"),si=c(function(){return Kt},"getSections"),oi=c(function(){let t=ge();const e=10;let i=0;for(;!t&&i<e;)t=ge(),i++;return At=B,At},"getTasks"),Fe=c(function(t,e,i,a){const s=t.format(e.trim()),d=t.format("YYYY-MM-DD");return a.includes(s)||a.includes(d)?!1:i.includes("weekends")&&(t.isoWeekday()===ye[Ft]||t.isoWeekday()===ye[Ft]+1)||i.includes(t.format("dddd").toLowerCase())?!0:i.includes(s)||i.includes(d)},"isInvalidDate"),ci=c(function(t){re=t},"setWeekday"),li=c(function(){return re},"getWeekday"),ui=c(function(t){Ft=t},"setWeekend"),Le=c(function(t,e,i,a){if(!i.length||t.manualEndTime)return;let s;t.startTime instanceof Date?s=G(t.startTime):s=G(t.startTime,e,!0),s=s.add(1,"d");let d;t.endTime instanceof Date?d=G(t.endTime):d=G(t.endTime,e,!0);const[u,g]=di(s,d,e,i,a);t.endTime=u.toDate(),t.renderEndTime=g},"checkTaskDates"),di=c(function(t,e,i,a,s){let d=!1,u=null;for(;t<=e;)d||(u=e.toDate()),d=Fe(t,i,a,s),d&&(e=e.add(1,"d")),t=t.add(1,"d");return[e,u]},"fixTaskDates"),qt=c(function(t,e,i){if(i=i.trim(),c(g=>{const D=g.trim();return D==="x"||D==="X"},"isTimestampFormat")(e)&&/^\d+$/.test(i))return new Date(Number(i));const d=/^after\s+(?<ids>[\d\w- ]+)/.exec(i);if(d!==null){let g=null;for(const E of d.groups.ids.split(" ")){let p=ct(E);p!==void 0&&(!g||p.endTime>g.endTime)&&(g=p)}if(g)return g.endTime;const D=new Date;return D.setHours(0,0,0,0),D}let u=G(i,e.trim(),!0);if(u.isValid())return u.toDate();{ot.debug("Invalid date:"+i),ot.debug("With date format:"+e.trim());const g=new Date(i);if(g===void 0||isNaN(g.getTime())||g.getFullYear()<-1e4||g.getFullYear()>1e4)throw new Error("Invalid date:"+i);return g}},"getStartDate"),Ye=c(function(t){const e=/^(\d+(?:\.\d+)?)([Mdhmswy]|ms)$/.exec(t.trim());return e!==null?[Number.parseFloat(e[1]),e[2]]:[NaN,"ms"]},"parseDuration"),Oe=c(function(t,e,i,a=!1){i=i.trim();const d=/^until\s+(?<ids>[\d\w- ]+)/.exec(i);if(d!==null){let p=null;for(const C of d.groups.ids.split(" ")){let w=ct(C);w!==void 0&&(!p||w.startTime<p.startTime)&&(p=w)}if(p)return p.startTime;const L=new Date;return L.setHours(0,0,0,0),L}let u=G(i,e.trim(),!0);if(u.isValid())return a&&(u=u.add(1,"d")),u.toDate();let g=G(t);const[D,E]=Ye(i);if(!Number.isNaN(D)){const p=g.add(D,E);p.isValid()&&(g=p)}return g.toDate()},"getEndDate"),Et=0,mt=c(function(t){return t===void 0?(Et=Et+1,"task"+Et):t},"parseId"),fi=c(function(t,e){let i;e.substr(0,1)===":"?i=e.substr(1,e.length):i=e;const a=i.split(","),s={};ie(a,s,Ae);for(let u=0;u<a.length;u++)a[u]=a[u].trim();let d="";switch(a.length){case 1:s.id=mt(),s.startTime=t.endTime,d=a[0];break;case 2:s.id=mt(),s.startTime=qt(void 0,tt,a[0]),d=a[1];break;case 3:s.id=mt(a[0]),s.startTime=qt(void 0,tt,a[1]),d=a[2];break}return d&&(s.endTime=Oe(s.startTime,tt,d,xt),s.manualEndTime=G(d,"YYYY-MM-DD",!0).isValid(),Le(s,tt,vt,pt)),s},"compileData"),hi=c(function(t,e){let i;e.substr(0,1)===":"?i=e.substr(1,e.length):i=e;const a=i.split(","),s={};ie(a,s,Ae);for(let d=0;d<a.length;d++)a[d]=a[d].trim();switch(a.length){case 1:s.id=mt(),s.startTime={type:"prevTaskEnd",id:t},s.endTime={data:a[0]};break;case 2:s.id=mt(),s.startTime={type:"getStartDate",startData:a[0]},s.endTime={data:a[1]};break;case 3:s.id=mt(a[0]),s.startTime={type:"getStartDate",startData:a[1]},s.endTime={data:a[2]};break}return s},"parseData"),Xt,Mt,B=[],We={},mi=c(function(t,e){const i={section:kt,type:kt,processed:!1,manualEndTime:!1,renderEndTime:null,raw:{data:e},task:t,classes:[]},a=hi(Mt,e);i.raw.startTime=a.startTime,i.raw.endTime=a.endTime,i.id=a.id,i.prevTaskId=Mt,i.active=a.active,i.done=a.done,i.crit=a.crit,i.milestone=a.milestone,i.vert=a.vert,i.order=Ht,Ht++;const s=B.push(i);Mt=i.id,We[i.id]=s-1},"addTask"),ct=c(function(t){const e=We[t];return B[e]},"findTaskById"),ki=c(function(t,e){const i={section:kt,type:kt,description:t,task:t,classes:[]},a=fi(Xt,e);i.startTime=a.startTime,i.endTime=a.endTime,i.id=a.id,i.active=a.active,i.done=a.done,i.crit=a.crit,i.milestone=a.milestone,i.vert=a.vert,Xt=i,At.push(i)},"addTaskOrg"),ge=c(function(){const t=c(function(i){const a=B[i];let s="";switch(B[i].raw.startTime.type){case"prevTaskEnd":{const d=ct(a.prevTaskId);a.startTime=d.endTime;break}case"getStartDate":s=qt(void 0,tt,B[i].raw.startTime.startData),s&&(B[i].startTime=s);break}return B[i].startTime&&(B[i].endTime=Oe(B[i].startTime,tt,B[i].raw.endTime.data,xt),B[i].endTime&&(B[i].processed=!0,B[i].manualEndTime=G(B[i].raw.endTime.data,"YYYY-MM-DD",!0).isValid(),Le(B[i],tt,vt,pt))),B[i].processed},"compileTask");let e=!0;for(const[i,a]of B.entries())t(i),e=e&&a.processed;return e},"compileTasks"),yi=c(function(t,e){let i=e;ft().securityLevel!=="loose"&&(i=sr.sanitizeUrl(e)),t.split(",").forEach(function(a){ct(a)!==void 0&&(ze(a,()=>{window.open(i,"_self")}),Qt.set(a,i))}),Ve(t,"clickable")},"setLink"),Ve=c(function(t,e){t.split(",").forEach(function(i){let a=ct(i);a!==void 0&&a.classes.push(e)})},"setClass"),gi=c(function(t,e,i){if(ft().securityLevel!=="loose"||e===void 0)return;let a=[];if(typeof i=="string"){a=i.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);for(let d=0;d<a.length;d++){let u=a[d].trim();u.startsWith('"')&&u.endsWith('"')&&(u=u.substr(1,u.length-2)),a[d]=u}}a.length===0&&a.push(t),ct(t)!==void 0&&ze(t,()=>{cr.runFunc(e,...a)})},"setClickFun"),ze=c(function(t,e){te.push(function(){const i=dt?`${dt}-${t}`:t,a=document.querySelector(`[id="${i}"]`);a!==null&&a.addEventListener("click",function(){e()})},function(){const i=dt?`${dt}-${t}`:t,a=document.querySelector(`[id="${i}-text"]`);a!==null&&a.addEventListener("click",function(){e()})})},"pushFun"),pi=c(function(t,e,i){t.split(",").forEach(function(a){gi(a,e,i)}),Ve(t,"clickable")},"setClickEvent"),vi=c(function(t){te.forEach(function(e){e(t)})},"bindFunctions"),xi={getConfig:c(()=>ft().gantt,"getConfig"),clear:zr,setDateFormat:Xr,getDateFormat:Jr,enableInclusiveEndDates:Gr,endDatesAreInclusive:Ur,enableTopAxis:Zr,topAxisEnabled:jr,setAxisFormat:Pr,getAxisFormat:Rr,setTickInterval:$r,getTickInterval:Br,setTodayMarker:Hr,getTodayMarker:qr,setAccTitle:Xe,getAccTitle:qe,setDiagramTitle:He,getDiagramTitle:Be,setDiagramId:Nr,setDisplayMode:Qr,getDisplayMode:Kr,setAccDescription:$e,getAccDescription:Re,addSection:ai,getSections:si,getTasks:oi,addTask:mi,findTaskById:ct,addTaskOrg:ki,setIncludes:ti,getIncludes:ei,setExcludes:ri,getExcludes:ii,setClickEvent:pi,setLink:yi,getLinks:ni,bindFunctions:vi,parseDuration:Ye,isInvalidDate:Fe,setWeekday:ci,getWeekday:li,setWeekend:ui};function ie(t,e,i){let a=!0;for(;a;)a=!1,i.forEach(function(s){const d="^\\s*"+s+"\\s*$",u=new RegExp(d);t[0].match(u)&&(e[s]=!0,t.shift(1),a=!0)})}c(ie,"getTaskTags");G.extend(lr);var Ti=c(function(){ot.debug("Something is calling, setConf, remove the call")},"setConf"),pe={monday:nr,tuesday:ir,wednesday:rr,thursday:er,friday:tr,saturday:Je,sunday:Ke},bi=c((t,e)=>{let i=[...t].map(()=>-1/0),a=[...t].sort((d,u)=>d.startTime-u.startTime||d.order-u.order),s=0;for(const d of a)for(let u=0;u<i.length;u++)if(d.startTime>=i[u]){i[u]=d.endTime,d.order=u+e,u>s&&(s=u);break}return s},"getMaxIntersections"),rt,Pt=1e4,wi=c(function(t,e,i,a){const s=ft().gantt;a.db.setDiagramId(e);const d=ft().securityLevel;let u;d==="sandbox"&&(u=bt("#i"+e));const g=d==="sandbox"?bt(u.nodes()[0].contentDocument.body):bt("body"),D=d==="sandbox"?u.nodes()[0].contentDocument:document,E=D.getElementById(e);rt=E.parentElement.offsetWidth,rt===void 0&&(rt=1200),s.useWidth!==void 0&&(rt=s.useWidth);const p=a.db.getTasks();let L=[];for(const k of p)L.push(k.type);L=R(L);const C={};let w=2*s.topPadding;if(a.db.getDisplayMode()==="compact"||s.displayMode==="compact"){const k={};for(const b of p)k[b.section]===void 0?k[b.section]=[b]:k[b.section].push(b);let T=0;for(const b of Object.keys(k)){const y=bi(k[b],T)+1;T+=y,w+=y*(s.barHeight+s.barGap),C[b]=y}}else{w+=p.length*(s.barHeight+s.barGap);for(const k of L)C[k]=p.filter(T=>T.type===k).length}E.setAttribute("viewBox","0 0 "+rt+" "+w);const H=g.select(`[id="${e}"]`),I=Ge().domain([Ue(p,function(k){return k.startTime}),Ze(p,function(k){return k.endTime})]).rangeRound([0,rt-s.leftPadding-s.rightPadding]);function _(k,T){const b=k.startTime,y=T.startTime;let m=0;return b>y?m=1:b<y&&(m=-1),m}c(_,"taskCompare"),p.sort(_),M(p,rt,w),je(H,w,rt,s.useMaxWidth),H.append("text").text(a.db.getDiagramTitle()).attr("x",rt/2).attr("y",s.titleTopMargin).attr("class","titleText");function M(k,T,b){const y=s.barHeight,m=y+s.barGap,o=s.topPadding,l=s.leftPadding,f=Qe().domain([0,L.length]).range(["#00B9FA","#F95002"]).interpolate(yr);W(m,o,l,T,b,k,a.db.getExcludes(),a.db.getIncludes()),P(l,o,T,b),O(k,m,o,l,y,f,T),q(m,o),z(l,o,T,b)}c(M,"makeGantt");function O(k,T,b,y,m,o,l){k.sort((r,v)=>r.vert===v.vert?0:r.vert?1:-1);const h=[...new Set(k.map(r=>r.order))].map(r=>k.find(v=>v.order===r));H.append("g").selectAll("rect").data(h).enter().append("rect").attr("x",0).attr("y",function(r,v){return v=r.order,v*T+b-2}).attr("width",function(){return l-s.rightPadding/2}).attr("height",T).attr("class",function(r){for(const[v,Y]of L.entries())if(r.type===Y)return"section section"+v%s.numberSectionStyles;return"section section0"}).enter();const x=H.append("g").selectAll("rect").data(k).enter(),n=a.db.getLinks();if(x.append("rect").attr("id",function(r){return e+"-"+r.id}).attr("rx",3).attr("ry",3).attr("x",function(r){return r.milestone?I(r.startTime)+y+.5*(I(r.endTime)-I(r.startTime))-.5*m:I(r.startTime)+y}).attr("y",function(r,v){return v=r.order,r.vert?s.gridLineStartPadding:v*T+b}).attr("width",function(r){return r.milestone?m:r.vert?.08*m:I(r.renderEndTime||r.endTime)-I(r.startTime)}).attr("height",function(r){return r.vert?p.length*(s.barHeight+s.barGap)+s.barHeight*2:m}).attr("transform-origin",function(r,v){return v=r.order,(I(r.startTime)+y+.5*(I(r.endTime)-I(r.startTime))).toString()+"px "+(v*T+b+.5*m).toString()+"px"}).attr("class",function(r){const v="task";let Y="";r.classes.length>0&&(Y=r.classes.join(" "));let F=0;for(const[X,S]of L.entries())r.type===S&&(F=X%s.numberSectionStyles);let A="";return r.active?r.crit?A+=" activeCrit":A=" active":r.done?r.crit?A=" doneCrit":A=" done":r.crit&&(A+=" crit"),A.length===0&&(A=" task"),r.milestone&&(A=" milestone "+A),r.vert&&(A=" vert "+A),A+=F,A+=" "+Y,v+A}),x.append("text").attr("id",function(r){return e+"-"+r.id+"-text"}).text(function(r){return r.task}).attr("font-size",s.fontSize).attr("x",function(r){let v=I(r.startTime),Y=I(r.renderEndTime||r.endTime);if(r.milestone&&(v+=.5*(I(r.endTime)-I(r.startTime))-.5*m,Y=v+m),r.vert)return I(r.startTime)+y;const F=this.getBBox().width;return F>Y-v?Y+F+1.5*s.leftPadding>l?v+y-5:Y+y+5:(Y-v)/2+v+y}).attr("y",function(r,v){return r.vert?s.gridLineStartPadding+p.length*(s.barHeight+s.barGap)+60:(v=r.order,v*T+s.barHeight/2+(s.fontSize/2-2)+b)}).attr("text-height",m).attr("class",function(r){const v=I(r.startTime);let Y=I(r.endTime);r.milestone&&(Y=v+m);const F=this.getBBox().width;let A="";r.classes.length>0&&(A=r.classes.join(" "));let X=0;for(const[Q,nt]of L.entries())r.type===nt&&(X=Q%s.numberSectionStyles);let S="";return r.active&&(r.crit?S="activeCritText"+X:S="activeText"+X),r.done?r.crit?S=S+" doneCritText"+X:S=S+" doneText"+X:r.crit&&(S=S+" critText"+X),r.milestone&&(S+=" milestoneText"),r.vert&&(S+=" vertText"),F>Y-v?Y+F+1.5*s.leftPadding>l?A+" taskTextOutsideLeft taskTextOutside"+X+" "+S:A+" taskTextOutsideRight taskTextOutside"+X+" "+S+" width-"+F:A+" taskText taskText"+X+" "+S+" width-"+F}),ft().securityLevel==="sandbox"){let r;r=bt("#i"+e);const v=r.nodes()[0].contentDocument;x.filter(function(Y){return n.has(Y.id)}).each(function(Y){var F=v.querySelector("#"+CSS.escape(e+"-"+Y.id)),A=v.querySelector("#"+CSS.escape(e+"-"+Y.id+"-text"));const X=F.parentNode;var S=v.createElement("a");S.setAttribute("xlink:href",n.get(Y.id)),S.setAttribute("target","_top"),X.appendChild(S),S.appendChild(F),S.appendChild(A)})}}c(O,"drawRects");function W(k,T,b,y,m,o,l,f){if(l.length===0&&f.length===0)return;let h,x;for(const{startTime:F,endTime:A}of o)(h===void 0||F<h)&&(h=F),(x===void 0||A>x)&&(x=A);if(!h||!x)return;if(G(x).diff(G(h),"year")>5){ot.warn("The difference between the min and max time is more than 5 years. This will cause performance issues. Skipping drawing exclude days.");return}const n=a.db.getDateFormat(),V=[];let r=null,v=G(h);for(;v.valueOf()<=x;)a.db.isInvalidDate(v,n,l,f)?r?r.end=v:r={start:v,end:v}:r&&(V.push(r),r=null),v=v.add(1,"d");H.append("g").selectAll("rect").data(V).enter().append("rect").attr("id",F=>e+"-exclude-"+F.start.format("YYYY-MM-DD")).attr("x",F=>I(F.start.startOf("day"))+b).attr("y",s.gridLineStartPadding).attr("width",F=>I(F.end.endOf("day"))-I(F.start.startOf("day"))).attr("height",m-T-s.gridLineStartPadding).attr("transform-origin",function(F,A){return(I(F.start)+b+.5*(I(F.end)-I(F.start))).toString()+"px "+(A*k+.5*m).toString()+"px"}).attr("class","exclude-range")}c(W,"drawExcludeDays");function N(k,T,b,y){if(b<=0||k>T)return 1/0;const m=T-k,o=G.duration({[y??"day"]:b}).asMilliseconds();return o<=0?1/0:Math.ceil(m/o)}c(N,"getEstimatedTickCount");function P(k,T,b,y){const m=a.db.getDateFormat(),o=a.db.getAxisFormat();let l;o?l=o:m==="D"?l="%d":l=s.axisFormat??"%Y-%m-%d";let f=_r(I).tickSize(-y+T+s.gridLineStartPadding).tickFormat(ae(l));const x=/^([1-9]\d*)(millisecond|second|minute|hour|day|week|month)$/.exec(a.db.getTickInterval()||s.tickInterval);if(x!==null){const n=parseInt(x[1],10);if(isNaN(n)||n<=0)ot.warn(`Invalid tick interval value: "${x[1]}". Skipping custom tick interval.`);else{const V=x[2],r=a.db.getWeekday()||s.weekday,v=I.domain(),Y=v[0],F=v[1],A=N(Y,F,n,V);if(A>Pt)ot.warn(`The tick interval "${n}${V}" would generate ${A} ticks, which exceeds the maximum allowed (${Pt}). This may indicate an invalid date or time range. Skipping custom tick interval.`);else switch(V){case"millisecond":f.ticks(de.every(n));break;case"second":f.ticks(ue.every(n));break;case"minute":f.ticks(le.every(n));break;case"hour":f.ticks(ce.every(n));break;case"day":f.ticks(oe.every(n));break;case"week":f.ticks(pe[r].every(n));break;case"month":f.ticks(se.every(n));break}}}if(H.append("g").attr("class","grid").attr("transform","translate("+k+", "+(y-50)+")").call(f).selectAll("text").style("text-anchor","middle").attr("fill","#000").attr("stroke","none").attr("font-size",10).attr("dy","1em"),a.db.topAxisEnabled()||s.topAxis){let n=wr(I).tickSize(-y+T+s.gridLineStartPadding).tickFormat(ae(l));if(x!==null){const V=parseInt(x[1],10);if(isNaN(V)||V<=0)ot.warn(`Invalid tick interval value: "${x[1]}". Skipping custom tick interval.`);else{const r=x[2],v=a.db.getWeekday()||s.weekday,Y=I.domain(),F=Y[0],A=Y[1];if(N(F,A,V,r)<=Pt)switch(r){case"millisecond":n.ticks(de.every(V));break;case"second":n.ticks(ue.every(V));break;case"minute":n.ticks(le.every(V));break;case"hour":n.ticks(ce.every(V));break;case"day":n.ticks(oe.every(V));break;case"week":n.ticks(pe[v].every(V));break;case"month":n.ticks(se.every(V));break}}}H.append("g").attr("class","grid").attr("transform","translate("+k+", "+T+")").call(n).selectAll("text").style("text-anchor","middle").attr("fill","#000").attr("stroke","none").attr("font-size",10)}}c(P,"makeGrid");function q(k,T){let b=0;const y=Object.keys(C).map(m=>[m,C[m]]);H.append("g").selectAll("text").data(y).enter().append(function(m){const o=m[0].split(ar.lineBreakRegex),l=-(o.length-1)/2,f=D.createElementNS("http://www.w3.org/2000/svg","text");f.setAttribute("dy",l+"em");for(const[h,x]of o.entries()){const n=D.createElementNS("http://www.w3.org/2000/svg","tspan");n.setAttribute("alignment-baseline","central"),n.setAttribute("x","10"),h>0&&n.setAttribute("dy","1em"),n.textContent=x,f.appendChild(n)}return f}).attr("x",10).attr("y",function(m,o){if(o>0)for(let l=0;l<o;l++)return b+=y[o-1][1],m[1]*k/2+b*k+T;else return m[1]*k/2+T}).attr("font-size",s.sectionFontSize).attr("class",function(m){for(const[o,l]of L.entries())if(m[0]===l)return"sectionTitle sectionTitle"+o%s.numberSectionStyles;return"sectionTitle"})}c(q,"vertLabels");function z(k,T,b,y){const m=a.db.getTodayMarker();if(m==="off")return;const o=H.append("g").attr("class","today"),l=new Date,f=o.append("line");f.attr("x1",I(l)+k).attr("x2",I(l)+k).attr("y1",s.titleTopMargin).attr("y2",y-s.titleTopMargin).attr("class","today"),m!==""&&f.attr("style",m.replace(/,/g,";"))}c(z,"drawToday");function R(k){const T={},b=[];for(let y=0,m=k.length;y<m;++y)Object.prototype.hasOwnProperty.call(T,k[y])||(T[k[y]]=!0,b.push(k[y]));return b}c(R,"checkUnique")},"draw"),_i={setConf:Ti,draw:wi},Di=c(t=>`
  .mermaid-main-font {
        font-family: ${t.fontFamily};
  }

  .exclude-range {
    fill: ${t.excludeBkgColor};
  }

  .section {
    stroke: none;
    opacity: 0.2;
  }

  .section0 {
    fill: ${t.sectionBkgColor};
  }

  .section2 {
    fill: ${t.sectionBkgColor2};
  }

  .section1,
  .section3 {
    fill: ${t.altSectionBkgColor};
    opacity: 0.2;
  }

  .sectionTitle0 {
    fill: ${t.titleColor};
  }

  .sectionTitle1 {
    fill: ${t.titleColor};
  }

  .sectionTitle2 {
    fill: ${t.titleColor};
  }

  .sectionTitle3 {
    fill: ${t.titleColor};
  }

  .sectionTitle {
    text-anchor: start;
    font-family: ${t.fontFamily};
  }


  /* Grid and axis */

  .grid .tick {
    stroke: ${t.gridColor};
    opacity: 0.8;
    shape-rendering: crispEdges;
  }

  .grid .tick text {
    font-family: ${t.fontFamily};
    fill: ${t.textColor};
  }

  .grid path {
    stroke-width: 0;
  }


  /* Today line */

  .today {
    fill: none;
    stroke: ${t.todayLineColor};
    stroke-width: 2px;
  }


  /* Task styling */

  /* Default task */

  .task {
    stroke-width: 2;
  }

  .taskText {
    text-anchor: middle;
    font-family: ${t.fontFamily};
  }

  .taskTextOutsideRight {
    fill: ${t.taskTextDarkColor};
    text-anchor: start;
    font-family: ${t.fontFamily};
  }

  .taskTextOutsideLeft {
    fill: ${t.taskTextDarkColor};
    text-anchor: end;
  }


  /* Special case clickable */

  .task.clickable {
    cursor: pointer;
  }

  .taskText.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }

  .taskTextOutsideLeft.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }

  .taskTextOutsideRight.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }


  /* Specific task settings for the sections*/

  .taskText0,
  .taskText1,
  .taskText2,
  .taskText3 {
    fill: ${t.taskTextColor};
  }

  .task0,
  .task1,
  .task2,
  .task3 {
    fill: ${t.taskBkgColor};
    stroke: ${t.taskBorderColor};
  }

  .taskTextOutside0,
  .taskTextOutside2
  {
    fill: ${t.taskTextOutsideColor};
  }

  .taskTextOutside1,
  .taskTextOutside3 {
    fill: ${t.taskTextOutsideColor};
  }


  /* Active task */

  .active0,
  .active1,
  .active2,
  .active3 {
    fill: ${t.activeTaskBkgColor};
    stroke: ${t.activeTaskBorderColor};
  }

  .activeText0,
  .activeText1,
  .activeText2,
  .activeText3 {
    fill: ${t.taskTextDarkColor} !important;
  }


  /* Completed task */

  .done0,
  .done1,
  .done2,
  .done3 {
    stroke: ${t.doneTaskBorderColor};
    fill: ${t.doneTaskBkgColor};
    stroke-width: 2;
  }

  .doneText0,
  .doneText1,
  .doneText2,
  .doneText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  /* Done task text displayed outside the bar sits against the diagram background,
     not against the done-task bar, so it must use the outside/contrast color. */
  .doneText0.taskTextOutsideLeft,
  .doneText0.taskTextOutsideRight,
  .doneText1.taskTextOutsideLeft,
  .doneText1.taskTextOutsideRight,
  .doneText2.taskTextOutsideLeft,
  .doneText2.taskTextOutsideRight,
  .doneText3.taskTextOutsideLeft,
  .doneText3.taskTextOutsideRight {
    fill: ${t.taskTextOutsideColor} !important;
  }


  /* Tasks on the critical line */

  .crit0,
  .crit1,
  .crit2,
  .crit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.critBkgColor};
    stroke-width: 2;
  }

  .activeCrit0,
  .activeCrit1,
  .activeCrit2,
  .activeCrit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.activeTaskBkgColor};
    stroke-width: 2;
  }

  .doneCrit0,
  .doneCrit1,
  .doneCrit2,
  .doneCrit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.doneTaskBkgColor};
    stroke-width: 2;
    cursor: pointer;
    shape-rendering: crispEdges;
  }

  .milestone {
    transform: rotate(45deg) scale(0.8,0.8);
  }

  .milestoneText {
    font-style: italic;
  }
  .doneCritText0,
  .doneCritText1,
  .doneCritText2,
  .doneCritText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  /* Done-crit task text outside the bar — same reasoning as doneText above. */
  .doneCritText0.taskTextOutsideLeft,
  .doneCritText0.taskTextOutsideRight,
  .doneCritText1.taskTextOutsideLeft,
  .doneCritText1.taskTextOutsideRight,
  .doneCritText2.taskTextOutsideLeft,
  .doneCritText2.taskTextOutsideRight,
  .doneCritText3.taskTextOutsideLeft,
  .doneCritText3.taskTextOutsideRight {
    fill: ${t.taskTextOutsideColor} !important;
  }

  .vert {
    stroke: ${t.vertLineColor};
  }

  .vertText {
    font-size: 15px;
    text-anchor: middle;
    fill: ${t.vertLineColor} !important;
  }

  .activeCritText0,
  .activeCritText1,
  .activeCritText2,
  .activeCritText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  .titleText {
    text-anchor: middle;
    font-size: 18px;
    fill: ${t.titleColor||t.textColor};
    font-family: ${t.fontFamily};
  }
`,"getStyles"),Ci=Di,Ei={parser:Vr,db:xi,renderer:_i,styles:Ci};export{Ei as diagram};
