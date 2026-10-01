import { isDraftUploadEnabled, SKU_UPLOAD_ENABLED_FIELD_KEY } from "./sku-upload-selection.js";
import { resolveDraftSkuPrefix, SKU_PREFIX_FIELD_KEY } from "./product-editor-field-model.js";
import { t } from "./i18n.js";

function text(key, fallback, substitutions) {
  return t(key, substitutions, fallback);
}
const objectValue = {
  key: SKU_UPLOAD_ENABLED_FIELD_KEY,
  label: "",
  width: 34
};
const objectValue4 = {
  key: SKU_PREFIX_FIELD_KEY,
  label: text("productEditor_columnSkuPrefix", "SKU前缀"),
  width: 126
};
export const FIXED_COLUMNS = [objectValue, {
  key: "__duplicate__",
  label: text("productEditor_columnDuplicate", "复制"),
  width: 46
}, {
  key: "__index__",
  label: text("productEditor_columnIndex", "序号"),
  width: 44
}, objectValue4, {
  key: "__spec__",
  label: text("productEditor_columnSpec", "规格"),
  width: 160
}, {
  key: "__image__",
  label: text("productEditor_columnImage", "图片"),
  width: 52
}];
const reduceResult4 = FIXED_COLUMNS.reduce((arg3, arg4, arg5) => {
  arg3.push(arg5 === 0 ? 0 : arg3[arg5 - 1] + FIXED_COLUMNS[arg5 - 1].width);
  return arg3;
}, []);
export function createTableShell(arg6, {
  drafts: resolvedValue5,
  onFieldChange: resolvedValue6
} = {}) {
  const createElementResult5 = document.createElement("section");
  createElementResult5.className = "editor-section";
  const createElementResult6 = document.createElement("div");
  createElementResult6.className = "editor-table-shell";
  const helperValue2 = function () {
    const createElementResult7 = document.createElement("div");
    createElementResult7.className = "editor-scroll-sync";
    const createElementResult8 = document.createElement("div");
    createElementResult8.className = "editor-scroll-sync-inner";
    createElementResult7.appendChild(createElementResult8);
    return createElementResult7;
  }();
  const createElementResult9 = document.createElement("div");
  createElementResult9.className = "editor-table-header-viewport";
  const createElementResult10 = document.createElement("div");
  createElementResult10.className = "editor-table-header-scroller";
  const objectValue7 = {
    drafts: resolvedValue5,
    onFieldChange: resolvedValue6
  };
  const arrayValue = helperFn(arg6, true, objectValue7);
  createElementResult10.appendChild(arrayValue);
  createElementResult9.appendChild(createElementResult10);
  const createElementResult11 = document.createElement("div");
  createElementResult11.className = "editor-table-body-viewport";
  const createElementResult12 = document.createElement("div");
  createElementResult12.className = "editor-table-body-scroller";
  const arrayValue2 = helperFn(arg6, false);
  createElementResult12.appendChild(arrayValue2);
  createElementResult11.appendChild(createElementResult12);
  createElementResult6.appendChild(createElementResult9);
  createElementResult6.appendChild(createElementResult11);
  createElementResult6.appendChild(helperValue2);
  createElementResult5.appendChild(createElementResult6);
  return {
    root: createElementResult5,
    headerTable: arrayValue,
    bodyTable: arrayValue2
  };
}
export function applyStickyColumn(arg7, arg8, arg9) {
  arg7.classList.add("editor-sticky-col", "editor-sticky-col-" + (arg8 + 1));
  arg7.style.left = (reduceResult4[arg8] || 0) + "px";
  if (arg9) {
    arg7.classList.add("is-header");
  }
}
function helperFn(arg10, arg11, {
  drafts: resolvedValue7,
  onFieldChange: resolvedValue8
} = {}) {
  const createElementResult13 = document.createElement("table");
  createElementResult13.className = arg11 ? "editor-table editor-table-header" : "editor-table editor-table-body";
  (function (arg12, arg13) {
    const createElementResult14 = document.createElement("colgroup");
    const localValue15 = FIXED_COLUMNS.reduce((arg14, arg15) => arg14 + Number(arg15.width || 0), 0) + arg13.reduce((arg16, arg17) => arg16 + Number(arg17.width || 0), 0);
    FIXED_COLUMNS.forEach((arg18) => {
      const createElementResult16 = document.createElement("col");
      createElementResult16.style.width = arg18.width + "px";
      createElementResult14.appendChild(createElementResult16);
    });
    arg13.forEach((arg19) => {
      const createElementResult17 = document.createElement("col");
      createElementResult17.style.width = arg19.width + "px";
      createElementResult14.appendChild(createElementResult17);
    });
    arg12.appendChild(createElementResult14);
    arg12.style.tableLayout = "fixed";
    arg12.style.width = localValue15 + "px";
    arg12.style.minWidth = localValue15 + "px";
  })(createElementResult13, arg10);
  if (arg11) {
    const createElementResult18 = document.createElement("thead");
    const createElementResult19 = document.createElement("tr");
    FIXED_COLUMNS.forEach((arg20, arg21) => {
      const createElementResult20 = document.createElement("th");
      (function (arg22, arg23, {
        drafts: resolvedValue9,
        onFieldChange: resolvedValue10
      } = {}) {
        const selectedValue21 = Array.isArray(resolvedValue9) ? resolvedValue9 : [];
        if (arg23.key === SKU_PREFIX_FIELD_KEY) {
          const createElementResult22 = document.createElement("div");
          createElementResult22.className = "th-fixed-label";
          createElementResult22.textContent = arg23.label;
          arg22.appendChild(createElementResult22);
          if (resolvedValue10 && selectedValue21.length) {
            const createElementResult23 = document.createElement("button");
            createElementResult23.type = "button";
            createElementResult23.className = "th-sync-btn";
            createElementResult23.textContent = text("productEditor_syncFirstRow", "同首行");
            helperFn2(createElementResult23, () => {
              resolvedValue10({
                fieldKey: SKU_PREFIX_FIELD_KEY,
                value: helperFn3(arg22, selectedValue21[0]),
                scope: "allRows"
              });
            });
            arg22.appendChild(createElementResult23);
          }
          return;
        }
        if (arg23.key !== SKU_UPLOAD_ENABLED_FIELD_KEY) {
          arg22.textContent = arg23.label;
          return;
        }
        arg22.classList.add("editor-table-upload-check");
        const createElementResult24 = document.createElement("input");
        createElementResult24.type = "checkbox";
        createElementResult24.className = "editor-upload-all-checkbox";
        createElementResult24.title = text("productEditor_toggleAllSkuUploadTitle", "全选 / 全取消 SKU 上传");
        createElementResult24.disabled = !resolvedValue10;
        const memberValue25 = selectedValue21.filter((arg24) => isDraftUploadEnabled(arg24)).length;
        createElementResult24.checked = selectedValue21.length > 0 && memberValue25 === selectedValue21.length;
        createElementResult24.indeterminate = memberValue25 > 0 && memberValue25 < selectedValue21.length;
        createElementResult24.addEventListener("change", () => {
          const objectValue8 = {
            scope: "allSkuUpload",
            fieldKey: SKU_UPLOAD_ENABLED_FIELD_KEY,
            value: createElementResult24.checked
          };
          resolvedValue10?.(objectValue8);
        });
        arg22.appendChild(createElementResult24);
      })(createElementResult20, arg20, {
        drafts: resolvedValue7,
        onFieldChange: resolvedValue8
      });
      createElementResult20.title = arg20.label;
      applyStickyColumn(createElementResult20, arg21, true);
      createElementResult19.appendChild(createElementResult20);
    });
    const selectedValue26 = Array.isArray(resolvedValue7) && resolvedValue7.length > 0 ? resolvedValue7[0] : null;
    arg10.forEach((arg25) => {
      const createElementResult27 = document.createElement("th");
      createElementResult27.title = String(arg25.label || "");
      const createElementResult28 = document.createElement("div");
      createElementResult28.className = "th-label";
      (function (arg26, arg27) {
        if (arg27.required) {
          const createElementResult29 = document.createElement("span");
          createElementResult29.className = "th-field-badge th-field-badge--required";
          createElementResult29.textContent = text("productEditor_requiredBadge", "（必填）");
          arg26.appendChild(createElementResult29);
        }
        if (arg27.isVariant) {
          const createElementResult30 = document.createElement("span");
          createElementResult30.className = "th-field-badge th-field-badge--variant";
          createElementResult30.textContent = text("productEditor_variantBadge", "（变体）");
          arg26.appendChild(createElementResult30);
        }
        arg26.appendChild(document.createTextNode(arg27.baseLabel || arg27.label || ""));
      })(createElementResult28, arg25);
      createElementResult27.appendChild(createElementResult28);
      if (!arg25.meta?._isNameField && resolvedValue8) {
        const createElementResult31 = document.createElement("button");
        createElementResult31.type = "button";
        createElementResult31.className = "th-sync-btn";
        createElementResult31.textContent = text("productEditor_syncFirstRow", "同首行");
        helperFn2(createElementResult31, () => {
          if (!selectedValue26) {
            return;
          }
          const helperValue3 = function (arg28, arg29, arg30) {
            const stringValue = String(arg29?.rowIndex ?? "");
            const stringValue2 = String(arg30 || "");
            const findResult32 = [...(arg28?.closest?.(".editor-section")?.querySelectorAll?.(".editor-table-body [data-field-key]") || [])].find((arg31) => String(arg31?.dataset?.rowIndex || "") === stringValue && String(arg31?.dataset?.fieldKey || "") === stringValue2);
            if (findResult32 && "value" in findResult32) {
              return findResult32.value;
            } else {
              return arg29?.fields?.[arg30];
            }
          }(createElementResult27, selectedValue26, arg25.fieldKey);
          resolvedValue8({
            fieldKey: arg25.fieldKey,
            value: helperValue3 == null ? "" : helperValue3,
            scope: "allRows"
          });
        });
        createElementResult27.appendChild(createElementResult31);
      }
      createElementResult19.appendChild(createElementResult27);
    });
    createElementResult18.appendChild(createElementResult19);
    createElementResult13.appendChild(createElementResult18);
  } else {
    const createElementResult33 = document.createElement("tbody");
    createElementResult13.appendChild(createElementResult33);
  }
  return createElementResult13;
}
function helperFn2(arg32, arg33) {
  let flagValue34 = false;
  arg32.addEventListener("mousedown", (arg34) => {
    if (arg34.button === undefined || arg34.button === 0) {
      arg34.preventDefault();
      flagValue34 = true;
      arg33();
    }
  });
  arg32.addEventListener("mouseup", () => {
    setTimeout(() => {
      flagValue34 = false;
    }, 0);
  });
  arg32.addEventListener("click", (arg35) => {
    if (flagValue34) {
      arg35.preventDefault();
    } else {
      arg33();
    }
  });
}
function helperFn3(arg36, arg37) {
  const localValue35 = arg36?.closest?.(".editor-section")?.querySelector?.(".editor-table-body .editor-sku-prefix-input");
  if (localValue35) {
    return String(localValue35.value || "").trim();
  } else if (arg37) {
    return resolveDraftSkuPrefix(arg37);
  } else {
    return "";
  }
}
