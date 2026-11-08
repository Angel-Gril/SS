import { getMultiSelectLimit, parseCollectionFieldValue } from "./product-editor-display-rules.js";
import { t } from "./i18n.js";

function text(key, fallback, substitutions) {
  return t(key, substitutions, fallback);
}

let localValue4 = null;
let flagValue5 = false;
function helperFn() {
  if (localValue4) {
    localValue4.remove();
    localValue4 = null;
  }
}
function helperFn2() {
  if (!flagValue5) {
    flagValue5 = true;
    document.addEventListener("mousedown", (arg3) => {
      if (localValue4 && !localValue4.contains(arg3.target)) {
        helperFn();
      }
    });
    document.addEventListener("keydown", (arg4) => {
      if (arg4.key === "Escape") {
        helperFn();
      }
    });
  }
}
export function createInlineControl(arg5, arg6) {
  const selectedValue6 = arg6 == null ? "" : String(arg6);
  if (arg5.editable === false) {
    const control = document.createElement('input'); control.className = 'editor-control';
    control.value = selectedValue6; control.disabled = true; return control;
  }
  if (arg5.officialDictionary && typeof arg5.openDictionary === 'function') {
    const control = document.createElement('button'); control.type = 'button';
    control.className = 'editor-control select-search-wrap'; control.textContent = selectedValue6 || '选择官方选项';
    Object.defineProperty(control, 'value', { get: () => selectedValue6 });
    control.addEventListener('click', (event) => {
      if (SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) arg5.openDictionary({ attributeId: arg5.attributeId, rowIndex: Number(control.dataset.rowIndex) });
    });
    return control;
  }
  const selectedValue7 = Array.isArray(arg5.options) ? arg5.options.filter(Boolean) : [];
  const flagValueoolean = Boolean(arg5?._freeTextDictionaryValue);
  if (arg5?.isCollection && selectedValue7.length) {
    const maximum = getMultiSelectLimit(arg5);
    const setValue8 = new Set(parseCollectionFieldValue(selectedValue6, maximum));
    const createElementResult9 = document.createElement("div");
    createElementResult9.className = "editor-control multiselect-wrap";
    createElementResult9.style.cssText = "position:relative;cursor:pointer;user-select:none;overflow:hidden;";
    Object.defineProperty(createElementResult9, "value", {
      get: () => JSON.stringify([...setValue8]),
      enumerable: true,
      configurable: true
    });
    const createElementResult10 = document.createElement("div");
    function helperFn3() {
      createElementResult10.innerHTML = "";
      const arrayValue = [...setValue8];
      if (arrayValue.length) {
        arrayValue.forEach((arg7) => {
          const createElementResult11 = document.createElement("span");
          createElementResult11.style.cssText = "background:var(--brand);color:#fff;border-radius:3px;padding:1px 5px;font-size:11px;white-space:nowrap;flex-shrink:0;";
          createElementResult11.textContent = arg7;
          createElementResult10.appendChild(createElementResult11);
        });
      } else {
        const createElementResult12 = document.createElement("span");
        createElementResult12.style.cssText = "color:var(--muted);";
        createElementResult12.textContent = text("productEditor_clickToSelect", "点击选择…");
        createElementResult10.appendChild(createElementResult12);
      }
    }
    createElementResult10.className = "multiselect-display";
    createElementResult10.style.cssText = "padding:0 6px;height:100%;display:flex;align-items:center;font-size:12px;gap:4px;flex-wrap:nowrap;overflow:hidden;";
    helperFn3();
    createElementResult9.addEventListener("mousedown", (arg8) => {
      arg8.preventDefault();
      arg8.stopPropagation();
      if (localValue4 && localValue4._owner === createElementResult9) {
        helperFn();
        return;
      }
      helperFn();
      helperFn2();
      const getBoundingClientRectResult13 = createElementResult9.getBoundingClientRect();
      const createElementResult14 = document.createElement("div");
      createElementResult14._owner = createElementResult9;
      createElementResult14.style.cssText = ["position:fixed", "left:" + Math.round(getBoundingClientRectResult13.left) + "px", "top:" + Math.round(getBoundingClientRectResult13.bottom + 2) + "px", "z-index:99999", "background:var(--bg,#fff)", "border:1px solid var(--line,#ddd)", "border-radius:6px", "padding:4px", "min-width:160px", "box-shadow:0 4px 16px rgba(0,0,0,0.18)", "display:flex", "flex-direction:column"].join(";");
      const createElementResult15 = document.createElement("input");
      createElementResult15.type = "text";
      createElementResult15.placeholder = text("productEditor_searchPlaceholder", "搜索…");
      createElementResult15.style.cssText = "width:100%;box-sizing:border-box;border:1px solid var(--line,#ddd);border-radius:4px;padding:4px 7px;font-size:12px;margin-bottom:4px;outline:none;";
      createElementResult14.appendChild(createElementResult15);
      const createElementResult16 = document.createElement("div");
      createElementResult16.style.cssText = "max-height:200px;overflow-y:auto;";
      createElementResult14.appendChild(createElementResult16);
      const arrayValue2 = [];
      selectedValue7.forEach((arg9) => {
        const createElementResult17 = document.createElement("label");
        createElementResult17.style.cssText = "display:flex;align-items:center;gap:7px;padding:4px 8px;cursor:pointer;font-size:12px;white-space:nowrap;border-radius:4px;";
        createElementResult17.addEventListener("mouseenter", () => {
          createElementResult17.style.background = "var(--hover,#f5f5f5)";
        });
        createElementResult17.addEventListener("mouseleave", () => {
          createElementResult17.style.background = "";
        });
        const createElementResult18 = document.createElement("input");
        createElementResult18.type = "checkbox";
        createElementResult18.value = arg9;
        createElementResult18.checked = setValue8.has(arg9);
        createElementResult18.style.cssText = "flex-shrink:0;cursor:pointer;";
        createElementResult18.addEventListener("change", () => {
          if (createElementResult18.checked) {
            if (!setValue8.has(arg9) && setValue8.size >= maximum) {
              createElementResult18.checked = false;
              return;
            }
            setValue8.add(arg9);
          } else {
            setValue8.delete(arg9);
          }
          helperFn3();
          createElementResult9.dispatchEvent(new Event("change", {
            bubbles: true
          }));
        });
        createElementResult17.appendChild(createElementResult18);
        createElementResult17.appendChild(document.createTextNode(arg9));
        createElementResult16.appendChild(createElementResult17);
        arrayValue2.push({
          label: createElementResult17,
          text: arg9.toLowerCase()
        });
      });
      createElementResult15.addEventListener("input", () => {
        const toLowerCaseResult19 = createElementResult15.value.toLowerCase();
        arrayValue2.forEach(({
          label: resolvedValue3,
          text: resolvedValue4
        }) => {
          resolvedValue3.style.display = resolvedValue4.includes(toLowerCaseResult19) ? "" : "none";
        });
      });
      createElementResult14.addEventListener("mousedown", (arg10) => arg10.stopPropagation());
      document.body.appendChild(createElementResult14);
      localValue4 = createElementResult14;
      const getBoundingClientRectResult20 = createElementResult14.getBoundingClientRect();
      if (getBoundingClientRectResult20.bottom > window.innerHeight - 8) {
        createElementResult14.style.top = Math.round(getBoundingClientRectResult13.top - getBoundingClientRectResult20.height - 2) + "px";
      }
      createElementResult15.focus();
    });
    createElementResult9.appendChild(createElementResult10);
    return createElementResult9;
  }
  if (selectedValue7.length || arg5?.valueKind === "select" && !flagValueoolean) {
    const trimResult21 = selectedValue6.trim();
    const arrayValue3 = [...new Set(selectedValue7.map((arg11) => String(arg11).trim()).filter(Boolean))];
    const localValue22 = !!trimResult21 && arrayValue3.some((arg12) => arg12 === trimResult21);
    let selectedValue23 = localValue22 ? trimResult21 : "";
    const createElementResult24 = document.createElement("div");
    createElementResult24.className = "editor-control select-search-wrap";
    createElementResult24.style.cssText = "cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;box-sizing:border-box;";
    if (trimResult21 && !localValue22) {
      createElementResult24.title = text("productEditor_invalidAiValueTitle", `AI 返回了不在当前选项列表中的值：${trimResult21}`, [trimResult21]);
      createElementResult24.dataset.invalidValue = trimResult21;
    }
    Object.defineProperty(createElementResult24, "value", {
      get: () => selectedValue23,
      set(arg13) {
        selectedValue23 = arg13;
        helperFn4();
      },
      enumerable: true,
      configurable: true
    });
    const createElementResult25 = document.createElement("span");
    createElementResult25.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;";
    const createElementResult26 = document.createElement("span");
    function helperFn4() {
      if (selectedValue23) {
        createElementResult25.textContent = selectedValue23;
        createElementResult25.style.color = "";
      } else if (trimResult21 && !localValue22) {
        createElementResult25.textContent = text("productEditor_selectInvalidAiValue", `请选择（AI原值无效：${trimResult21}）`, [trimResult21]);
        createElementResult25.style.color = "var(--muted,#888)";
      } else {
        createElementResult25.textContent = text("productEditor_selectPlaceholder", "请选择");
        createElementResult25.style.color = "var(--muted,#888)";
      }
    }
    createElementResult26.style.cssText = "flex-shrink:0;margin-left:4px;font-size:10px;color:var(--muted,#888);";
    createElementResult26.textContent = "▾";
    createElementResult24.appendChild(createElementResult25);
    createElementResult24.appendChild(createElementResult26);
    helperFn4();
    createElementResult24.addEventListener("mousedown", (arg14) => {
      arg14.preventDefault();
      arg14.stopPropagation();
      if (localValue4 && localValue4._owner === createElementResult24) {
        helperFn();
        return;
      }
      helperFn();
      helperFn2();
      const getBoundingClientRectResult27 = createElementResult24.getBoundingClientRect();
      const createElementResult28 = document.createElement("div");
      createElementResult28._owner = createElementResult24;
      createElementResult28.style.cssText = ["position:fixed", "left:" + Math.round(getBoundingClientRectResult27.left) + "px", "top:" + Math.round(getBoundingClientRectResult27.bottom + 2) + "px", "z-index:99999", "background:var(--bg,#fff)", "border:1px solid var(--line,#ddd)", "border-radius:6px", "padding:4px", "min-width:" + Math.max(getBoundingClientRectResult27.width, 160) + "px", "box-shadow:0 4px 16px rgba(0,0,0,0.18)", "display:flex", "flex-direction:column"].join(";");
      const createElementResult29 = document.createElement("input");
      createElementResult29.type = "text";
      createElementResult29.placeholder = text("productEditor_searchPlaceholder", "搜索…");
      createElementResult29.style.cssText = "width:100%;box-sizing:border-box;border:1px solid var(--line,#ddd);border-radius:4px;padding:4px 7px;font-size:12px;margin-bottom:4px;outline:none;";
      createElementResult28.appendChild(createElementResult29);
      const createElementResult30 = document.createElement("div");
      createElementResult30.style.cssText = "max-height:200px;overflow-y:auto;";
      createElementResult28.appendChild(createElementResult30);
      const createElementResult31 = document.createElement("div");
      createElementResult31.style.cssText = "padding:4px 8px;font-size:12px;cursor:pointer;border-radius:4px;color:var(--muted,#888);white-space:nowrap;";
      createElementResult31.textContent = text("productEditor_selectEmptyOption", "— 请选择 —");
      createElementResult31.addEventListener("mouseenter", () => {
        createElementResult31.style.background = "var(--hover,#f5f5f5)";
      });
      createElementResult31.addEventListener("mouseleave", () => {
        createElementResult31.style.background = "";
      });
      createElementResult31.addEventListener("mousedown", (arg15) => {
        arg15.preventDefault();
        selectedValue23 = "";
        helperFn4();
        createElementResult24.dispatchEvent(new Event("change", {
          bubbles: true
        }));
        helperFn();
      });
      createElementResult30.appendChild(createElementResult31);
      const arrayValue4 = [];
      arrayValue3.forEach((arg16) => {
        const createElementResult32 = document.createElement("div");
        createElementResult32.style.cssText = "padding:4px 8px;font-size:12px;cursor:pointer;border-radius:4px;white-space:nowrap;";
        if (arg16 === selectedValue23) {
          createElementResult32.style.fontWeight = "600";
        }
        createElementResult32.textContent = arg16;
        createElementResult32.addEventListener("mouseenter", () => {
          createElementResult32.style.background = "var(--hover,#f5f5f5)";
        });
        createElementResult32.addEventListener("mouseleave", () => {
          createElementResult32.style.background = "";
        });
        createElementResult32.addEventListener("mousedown", (arg17) => {
          arg17.preventDefault();
          selectedValue23 = arg16;
          helperFn4();
          createElementResult24.dispatchEvent(new Event("change", {
            bubbles: true
          }));
          helperFn();
        });
        createElementResult30.appendChild(createElementResult32);
        arrayValue4.push({
          item: createElementResult32,
          text: arg16.toLowerCase()
        });
      });
      createElementResult29.addEventListener("input", () => {
        const toLowerCaseResult33 = createElementResult29.value.toLowerCase();
        arrayValue4.forEach(({
          item: resolvedValue5,
          text: resolvedValue6
        }) => {
          resolvedValue5.style.display = resolvedValue6.includes(toLowerCaseResult33) ? "" : "none";
        });
      });
      createElementResult28.addEventListener("mousedown", (arg18) => arg18.stopPropagation());
      document.body.appendChild(createElementResult28);
      localValue4 = createElementResult28;
      const getBoundingClientRectResult34 = createElementResult28.getBoundingClientRect();
      if (getBoundingClientRectResult34.bottom > window.innerHeight - 8) {
        createElementResult28.style.top = Math.round(getBoundingClientRectResult27.top - getBoundingClientRectResult34.height - 2) + "px";
      }
      createElementResult29.focus();
    });
    return createElementResult24;
  }
  const createElementResult35 = document.createElement("input");
  createElementResult35.className = "editor-control";
  createElementResult35.type = arg5.valueKind === "numeric" ? "number" : "text";
  createElementResult35.value = selectedValue6;
  if (arg5.valueKind === "numeric") {
    createElementResult35.step = "any";
  }
  return createElementResult35;
}
