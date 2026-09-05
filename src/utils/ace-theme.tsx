import ace from "ace-builds/src-noconflict/ace";

const cssText = `

.ace-ai-lubricant .ace_gutter {
  background: #f8f8f8;
  color: #2e3440
}

.ace-ai-lubricant {
  background-color: #FFFFFF;
  color: #2e3440;
  line-height: 1.8 !important;
}

.ace-ai-lubricant .ace_cursor {
  color: #AEAFAD
}

.ace-ai-lubricant .ace_marker-layer .ace_selection {
  background: #e0e0e0
}

.ace-ai-lubricant.ace_multiselect .ace_selection.ace_start {
  box-shadow: 0 0 3px 0px #FFFFFF;
}

.ace-ai-lubricant .ace_marker-layer .ace_step {
  background: rgb(255, 255, 0)
}

.ace-ai-lubricant .ace_marker-layer .ace_bracket {
  margin: -1px 0 0 -1px;
  border: 1px solid #D1D1D1
}

.ace-ai-lubricant .ace_marker-layer .ace_active-line {
  background: #f4f4f4
}

.ace-ai-lubricant .ace_gutter-active-line {
  background-color : #f4f4f4
}

.ace-ai-lubricant .ace_marker-layer .ace_selected-word {
  border: 1px solid #e8e8e8
}

.ace-ai-lubricant .ace_invisible {
  color: #D1D1D1
}

.ace-ai-lubricant .ace_keyword,
.ace-ai-lubricant .ace_meta,
.ace-ai-lubricant .ace_storage,
.ace-ai-lubricant .ace_storage.ace_type,
.ace-ai-lubricant .ace_support.ace_type {
  color: #8959A8
}

.ace-ai-lubricant .ace_keyword.ace_operator {
  color: #3E999F
}

.ace-ai-lubricant .ace_constant.ace_character,
.ace-ai-lubricant .ace_constant.ace_language,
.ace-ai-lubricant .ace_constant.ace_numeric,
.ace-ai-lubricant .ace_keyword.ace_other.ace_unit,
.ace-ai-lubricant .ace_support.ace_constant,
.ace-ai-lubricant .ace_variable.ace_parameter {
  color: #F5871F
}

.ace-ai-lubricant .ace_constant.ace_other {
  color: #666969
}

.ace-ai-lubricant .ace_invalid {
  color: #FFFFFF;
  background-color: #C82829
}

.ace-ai-lubricant .ace_invalid.ace_deprecated {
  color: #FFFFFF;
  background-color: #8959A8
}

.ace-ai-lubricant .ace_fold {
  background-color: #4271AE;
  border-color: #2e3440
}

.ace-ai-lubricant .ace_entity.ace_name.ace_function,
.ace-ai-lubricant .ace_support.ace_function,
.ace-ai-lubricant .ace_variable {
  color: #C99E00
}

.ace-ai-lubricant .ace_support.ace_class,
.ace-ai-lubricant .ace_support.ace_type {
  color: #C99E00
}

.ace-ai-lubricant .ace_string {
  color: #5e81ac;
}

.ace-ai-lubricant .ace_markup {
  color: #8fbcbb !important;
}

.ace-ai-lubricant .ace_heading {
  color: #5e81ac;
  font-weight: bold;
}

.ace-ai-lubricant .ace_comment {
  color: #8E908C;
}

.dark .ace-ai-lubricant {
  background-color: #0d1117;
  color: #c9d1d9;
}

.dark .ace-ai-lubricant .ace_gutter {
  background: #161b22;
  color: #8b949e;
}

.dark .ace-ai-lubricant .ace_cursor {
  color: #c9d1d9;
}

.dark .ace-ai-lubricant .ace_marker-layer .ace_selection {
  background: #264f78;
}

.dark .ace-ai-lubricant.ace_multiselect .ace_selection.ace_start {
  box-shadow: 0 0 3px 0 #0d1117;
}

.dark .ace-ai-lubricant .ace_marker-layer .ace_step {
  background: #4b3f16;
}

.dark .ace-ai-lubricant .ace_marker-layer .ace_bracket {
  border-color: #6e7681;
}

.dark .ace-ai-lubricant .ace_marker-layer .ace_active-line,
.dark .ace-ai-lubricant .ace_gutter-active-line {
  background: #161b22;
}

.dark .ace-ai-lubricant .ace_marker-layer .ace_selected-word {
  border-color: #6e7681;
}

.dark .ace-ai-lubricant .ace_invisible {
  color: #484f58;
}

.dark .ace-ai-lubricant .ace_keyword,
.dark .ace-ai-lubricant .ace_meta,
.dark .ace-ai-lubricant .ace_storage,
.dark .ace-ai-lubricant .ace_storage.ace_type,
.dark .ace-ai-lubricant .ace_support.ace_type {
  color: #ff7b72;
}

.dark .ace-ai-lubricant .ace_keyword.ace_operator {
  color: #79c0ff;
}

.dark .ace-ai-lubricant .ace_constant.ace_character,
.dark .ace-ai-lubricant .ace_constant.ace_language,
.dark .ace-ai-lubricant .ace_constant.ace_numeric,
.dark .ace-ai-lubricant .ace_keyword.ace_other.ace_unit,
.dark .ace-ai-lubricant .ace_support.ace_constant,
.dark .ace-ai-lubricant .ace_variable.ace_parameter {
  color: #79c0ff;
}

.dark .ace-ai-lubricant .ace_constant.ace_other {
  color: #a5d6ff;
}

.dark .ace-ai-lubricant .ace_invalid {
  color: #ffdcd7;
  background-color: #da3633;
}

.dark .ace-ai-lubricant .ace_invalid.ace_deprecated {
  color: #ffdcd7;
  background-color: #8957e5;
}

.dark .ace-ai-lubricant .ace_fold {
  background-color: #58a6ff;
  border-color: #c9d1d9;
}

.dark .ace-ai-lubricant .ace_entity.ace_name.ace_function,
.dark .ace-ai-lubricant .ace_support.ace_function,
.dark .ace-ai-lubricant .ace_variable,
.dark .ace-ai-lubricant .ace_support.ace_class,
.dark .ace-ai-lubricant .ace_support.ace_type {
  color: #d2a8ff;
}

.dark .ace-ai-lubricant .ace_string,
.dark .ace-ai-lubricant .ace_heading {
  color: #a5d6ff;
}

.dark .ace-ai-lubricant .ace_markup {
  color: #7ee787 !important;
}

.dark .ace-ai-lubricant .ace_comment {
  color: #8b949e;
}
`;



ace.define(
    "ace/theme/ai_lubricant",
    ["require", "exports", "module", "ace/lib/dom"],
    function (require: any, exports: any) {
      exports.isDark = true;
      exports.cssClass = "ace-ai-lubricant";
      exports.cssText = cssText;
  
      const dom = require("ace/lib/dom");
      dom.importCssString(cssText, exports.cssClass);
    }
  );
