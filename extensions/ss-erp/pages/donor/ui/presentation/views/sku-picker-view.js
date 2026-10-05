import { t } from "../../modules/i18n.js";

export function createSkuPickerController({
  els: resolvedValue1,
  state: resolvedValue2,
  text: resolvedValue3,
  autoSeconds: resolvedValue4 = 30,
  setStatus: resolvedValue5
}) {
  let setValue4 = new Set();
  let arrayValue = [];
  let flagValue5 = false;
  let arrayValue2 = [];
  let flagValue6 = false;
  let loopIndex0 = 0;
  function helperFn0(key, substitutions, fallback) {
    return t(key, substitutions, fallback);
  }
  function helperFn(arg3) {
    if (!resolvedValue2.pendingSkuResolve) {
      return;
    }
    const memberValue7 = resolvedValue2.pendingSkuResolve;
    resolvedValue2.pendingSkuResolve = null;
    memberValue7(arg3);
  }
  function helperFn2(arg4, arg5) {
    return String(arg4?.row_id ?? arg5 + 1);
  }
  function helperFn3() {
    if (resolvedValue2.skuPickerAuto.timerId) {
      window.clearInterval(resolvedValue2.skuPickerAuto.timerId);
      resolvedValue2.skuPickerAuto.timerId = 0;
    }
  }
  function helperFn4() {
    helperFn3();
    resolvedValue2.skuPickerAuto.remainingSeconds = 0;
    resolvedValue2.skuPickerAuto.userInteracted = false;
  }
  function helperFn5() {
    if (!resolvedValue2.skuPickerAuto.userInteracted) {
      resolvedValue2.skuPickerAuto.userInteracted = true;
      helperFn3();
    }
  }
  function helperFn6() {
    const memberValue8 = arrayValue.length;
    const memberValue9 = setValue4.size;
    if (resolvedValue1.skuToggleBtn) {
      resolvedValue1.skuToggleBtn.textContent = memberValue8 > 0 && memberValue9 === memberValue8 ? helperFn0("panel_skuToggleNone", undefined, "全取消") : helperFn0("panel_skuToggleAll", undefined, "全选");
    }
    if (resolvedValue1.skuPickedCount) {
      let localValue10 = helperFn0("sku_selectedCount", [memberValue9, memberValue8], `已选择 ${memberValue9}/${memberValue8}`);
      if (resolvedValue2.skuPickerAuto.timerId && !resolvedValue2.skuPickerAuto.userInteracted) {
        localValue10 += helperFn0("sku_autoContinueSuffix", [resolvedValue2.skuPickerAuto.remainingSeconds], ` · ${resolvedValue2.skuPickerAuto.remainingSeconds}s后自动继续`);
      }
      resolvedValue1.skuPickedCount.textContent = localValue10;
    }
    if (resolvedValue1.skuApplyBtn) {
      const localValue10b = helperFn0("panel_skuConfirmContinue", undefined, resolvedValue3.skuApply || "确认SKU并继续");
      resolvedValue1.skuApplyBtn.textContent = resolvedValue2.skuPickerAuto.timerId && !resolvedValue2.skuPickerAuto.userInteracted ? localValue10b + " (" + resolvedValue2.skuPickerAuto.remainingSeconds + "s)" : localValue10b;
    }
  }
  function helperFn7() {
    helperFn4();
    setValue4 = new Set();
    arrayValue = [];
    arrayValue2 = [];
    helperFn13();
    if (resolvedValue1.skuPickerList) {
      helperFn14(resolvedValue1.skuPickerList, "is-virtualized");
      if (typeof resolvedValue1.skuPickerList.replaceChildren == "function") {
        resolvedValue1.skuPickerList.replaceChildren();
      } else {
        resolvedValue1.skuPickerList.innerHTML = "";
      }
    }
    if (resolvedValue1.skuPickedCount) {
      resolvedValue1.skuPickedCount.textContent = "";
    }
    if (resolvedValue1.skuToggleBtn) {
      resolvedValue1.skuToggleBtn.textContent = helperFn0("panel_skuToggleNone", undefined, "全取消");
    }
    if (resolvedValue1.skuApplyBtn) {
      resolvedValue1.skuApplyBtn.textContent = helperFn0("panel_skuConfirmContinue", undefined, resolvedValue3.skuApply || "确认SKU并继续");
    }
    if (resolvedValue1.skuPicker) {
      resolvedValue1.skuPicker.hidden = true;
    }
    resolvedValue2.pendingSkuRawData = null;
  }
  function helperFn8(arg6, initiallySelectedIds) {
    if (resolvedValue1.skuPicker && resolvedValue1.skuPickerList) {
      resolvedValue1.skuPicker.hidden = false;
      if (!flagValue5 && resolvedValue1.skuPickerList) {
        flagValue5 = true;
        resolvedValue1.skuPickerList.addEventListener("change", (arg7) => {
          const memberValue11 = arg7.target;
          if (memberValue11?.type === "checkbox" && memberValue11.dataset?.rowId) {
            helperFn5();
            if (memberValue11.checked) {
              setValue4.add(memberValue11.dataset.rowId);
            } else {
              setValue4.delete(memberValue11.dataset.rowId);
            }
            helperFn6();
          }
        });
      }
      setValue4 = new Set();
      arrayValue = [];
      arg6.forEach((arg8, arg9) => {
        const helperValue2 = helperFn2(arg8, arg9);
        arrayValue.push(helperValue2);
        if (!initiallySelectedIds || initiallySelectedIds.has(helperValue2)) setValue4.add(helperValue2);
      });
      if (arg6.length >= 80) {
        (function (arg10) {
          arrayValue2 = Array.isArray(arg10) ? arg10 : [];
          if (!flagValue6 && resolvedValue1.skuPickerList) {
            flagValue6 = true;
            resolvedValue1.skuPickerList.addEventListener("scroll", () => {
              var localValue12;
              if (arrayValue2.length && !loopIndex0) {
                localValue12 = () => {
                  loopIndex0 = 0;
                  helperFn9();
                };
                loopIndex0 = typeof requestAnimationFrame == "function" ? requestAnimationFrame(localValue12) : setTimeout(localValue12, 0);
              }
            });
          }
          (function (arg11, arg12) {
            if (arg11?.classList?.add) {
              arg11.classList.add(arg12);
              return;
            }
            const setValue13 = new Set(String(arg11?.className || "").split(/\s+/).filter(Boolean));
            setValue13.add(arg12);
            if (arg11) {
              arg11.className = [...setValue13].join(" ");
            }
          })(resolvedValue1.skuPickerList, "is-virtualized");
          resolvedValue1.skuPickerList.scrollTop = 0;
          helperFn9();
        })(arg6);
      } else {
        (function (arg13) {
          arrayValue2 = [];
          helperFn13();
          helperFn14(resolvedValue1.skuPickerList, "is-virtualized");
          const createDocumentFragmentResult14 = document.createDocumentFragment();
          arg13.forEach((arg14, arg15) => {
            createDocumentFragmentResult14.appendChild(helperFn10(arg14, arg15));
          });
          helperFn11(createDocumentFragmentResult14);
        })(arg6);
      }
      helperFn4();
      resolvedValue2.skuPickerAuto.remainingSeconds = resolvedValue4;
      if (resolvedValue4 <= 0) {
        helperFn6();
        return;
      }
      resolvedValue2.skuPickerAuto.timerId = window.setInterval(() => resolvedValue1.skuPicker?.hidden || resolvedValue2.skuPickerAuto.userInteracted ? (helperFn4(), void helperFn6()) : (resolvedValue2.skuPickerAuto.remainingSeconds -= 1, resolvedValue2.skuPickerAuto.remainingSeconds <= 0 ? (helperFn4(), helperFn6(), void helperFn12({
        autoTriggered: true
      })) : void helperFn6()), 1000);
      helperFn6();
    }
  }
  function helperFn9() {
    if (!resolvedValue1.skuPickerList || !arrayValue2.length) {
      return;
    }
    const memberValue15 = resolvedValue1.skuPickerList;
    const localValue16 = memberValue15.clientHeight || 420;
    const maxResult17 = Math.max(0, Math.floor(memberValue15.scrollTop / 84) - 8);
    const localValue18 = Math.ceil(localValue16 / 84) + 16;
    const minResult19 = Math.min(arrayValue2.length, maxResult17 + localValue18);
    const createElementResult20 = document.createElement("div");
    createElementResult20.className = "sku-picker-virtual-spacer";
    createElementResult20.style.height = arrayValue2.length * 84 + "px";
    for (let localValue = maxResult17; localValue < minResult19; localValue += 1) {
      const derivedValue6 = helperFn10(arrayValue2[localValue], localValue);
      derivedValue6.style.top = localValue * 84 + "px";
      createElementResult20.appendChild(derivedValue6);
    }
    helperFn11(createElementResult20);
  }
  function helperFn10(arg16, arg17) {
    const helperValue22 = helperFn2(arg16, arg17);
    const helperValue3 = function (arg18, arg19) {
      const localValue21 = arg18?.row_id ?? arg19 + 1;
      const localValue22 = arg18?.specs?.color_name_cn || helperFn0("sku_defaultColor", undefined, "默认");
      const localValue23 = arg18?.specifications ? '' : arg18?.specs?.size_name_cn || helperFn0("sku_defaultSize", undefined, "均码");
      const localValue24 = arg18?.price?.amount ?? "--";
      const localValue25 = arg18?.stock_quantity ?? arg18?.stock ?? "-";
      return {
        title: (localValue22 + " " + localValue23).trim(),
        sub: "SKU #" + localValue21,
        price: "¥" + localValue24,
        stock: helperFn0("sku_stockLabel", [localValue25], `库存 ${localValue25}`),
        imageUrl: arg18?.sku_image_url || ""
      };
    }(arg16, arg17);
    const createElementResult26 = document.createElement("label");
    createElementResult26.className = "sku-picker-item";
    const createElementResult27 = document.createElement("input");
    createElementResult27.type = "checkbox";
    createElementResult27.checked = setValue4.has(helperValue22);
    createElementResult27.dataset.rowId = helperValue22;
    const createElementResult28 = document.createElement("img");
    createElementResult28.className = "sku-thumb";
    createElementResult28.alt = helperFn0("common_image", undefined, resolvedValue3.imageAlt || "图片");
    createElementResult28.src = helperValue3.imageUrl || "";
    createElementResult28.loading = "lazy";
    createElementResult28.decoding = "async";
    const createElementResult29 = document.createElement("div");
    createElementResult29.className = "sku-main";
    const createElementResult30 = document.createElement("strong");
    createElementResult30.textContent = helperValue3.title;
    const createElementResult31 = document.createElement("div");
    createElementResult31.className = "sku-sub";
    createElementResult31.textContent = helperValue3.sub;
    createElementResult29.appendChild(createElementResult30);
    createElementResult29.appendChild(createElementResult31);
    const createElementResult32 = document.createElement("div");
    createElementResult32.className = "sku-side";
    const createElementResult33 = document.createElement("div");
    createElementResult33.textContent = helperValue3.price;
    const createElementResult34 = document.createElement("div");
    createElementResult34.textContent = helperValue3.stock;
    createElementResult32.append(createElementResult33, createElementResult34);
    createElementResult26.appendChild(createElementResult27);
    createElementResult26.appendChild(createElementResult28);
    createElementResult26.appendChild(createElementResult29);
    createElementResult26.appendChild(createElementResult32);
    return createElementResult26;
  }
  function helperFn11(arg20) {
    if (typeof resolvedValue1.skuPickerList.replaceChildren == "function") {
      resolvedValue1.skuPickerList.replaceChildren(arg20);
    } else {
      resolvedValue1.skuPickerList.innerHTML = "";
      resolvedValue1.skuPickerList.appendChild(arg20);
    }
  }
  function helperFn12(arg21 = {}) {
    if (!arg21.autoTriggered) {
      helperFn5();
    }
    const memberValue35 = resolvedValue2.pendingSkuRawData;
    if (!memberValue35 || !resolvedValue1.skuPickerList) {
      return;
    }
    if (!setValue4.size) {
      resolvedValue5(helperFn0("sku_statusNeedSelect", undefined, resolvedValue3.needSelectSku || "请至少选择一个 SKU。"), "err");
      return;
    }
    const filterResult36 = (memberValue35.sku_matrix || []).filter((arg22, arg23) => {
      const helperValue23 = helperFn2(arg22, arg23);
      return setValue4.has(helperValue23);
    });
    if (filterResult36.length) {
      helperFn7();
      helperFn({
        ...memberValue35,
        sku_matrix: filterResult36
      });
    } else {
      resolvedValue5(helperFn0("sku_statusNeedSelect", undefined, resolvedValue3.needSelectSku || "请至少选择一个 SKU。"), "err");
    }
  }
  function helperFn13() {
    if (loopIndex0) {
      if (typeof cancelAnimationFrame == "function") {
        cancelAnimationFrame(loopIndex0);
      }
      if (typeof clearTimeout == "function") {
        clearTimeout(loopIndex0);
      }
      loopIndex0 = 0;
    }
  }
  function helperFn14(arg24, arg25) {
    if (arg24?.classList?.remove) {
      arg24.classList.remove(arg25);
    } else if (arg24) {
      arg24.className = String(arg24.className || "").split(/\s+/).filter((arg26) => arg26 && arg26 !== arg25).join(" ");
    }
  }
  return {
    clear: helperFn7,
    cancelSelection: function () {
      helperFn(null);
      helperFn7();
      resolvedValue5(helperFn0("sku_statusSelectionAborted", undefined, resolvedValue3.skuSelectionAborted || "已取消 SKU 选择，本次未执行生成。"), "warn");
    },
    resolvePendingSelection: helperFn,
    onToggleSelection: function () {
      var localValue37;
      if (arrayValue.length) {
        helperFn5();
        setValue4 = (localValue37 = setValue4.size !== arrayValue.length) ? new Set(arrayValue) : new Set();
        (resolvedValue1.skuPickerList ? [...resolvedValue1.skuPickerList.querySelectorAll("input[type=\"checkbox\"][data-row-id]")] : []).forEach((arg27) => {
          arg27.checked = localValue37;
        });
        helperFn6();
      }
    },
    onApplySelection: helperFn12,
    onUserActivity: function (arg28) {
      if (arg28?.isTrusted && !resolvedValue1.skuPicker?.hidden && arg28.target !== resolvedValue1.skuPicker) {
        helperFn5();
      }
    },
    selectSkuRowsByUI: async function (arg29, options = {}) {
      const localValue38 = arg29?.sku_matrix || [];
      helperFn(null);
      helperFn7();
      if (localValue38.length <= 1) {
        return arg29;
      } else if (resolvedValue1.skuPicker && resolvedValue1.skuPickerList && resolvedValue1.skuApplyBtn) {
        resolvedValue2.pendingSkuRawData = arg29;
        helperFn8(localValue38, Array.isArray(options.selectedRowIds) ? new Set(options.selectedRowIds) : null);
        resolvedValue5(helperFn0("sku_statusPickerReady", undefined, resolvedValue3.skuPickerReady || "检测到多个 SKU，请勾选需要采集的 SKU 后点击确认。"), "warn");
        return new Promise((arg30) => {
          resolvedValue2.pendingSkuResolve = arg30;
        });
      } else {
        return arg29;
      }
    }
  };
}
