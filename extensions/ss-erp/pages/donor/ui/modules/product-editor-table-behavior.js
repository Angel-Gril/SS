export function setupScrollSync(arg3) {
  const querySelectorResult4 = arg3.querySelector(".editor-scroll-sync");
  const querySelectorResult5 = arg3.querySelector(".editor-scroll-sync-inner");
  const querySelectorResult6 = arg3.querySelector(".editor-table-header-viewport");
  const querySelectorResult7 = arg3.querySelector(".editor-table-header-scroller");
  const querySelectorResult8 = arg3.querySelector(".editor-table-body-scroller");
  const querySelectorResult9 = arg3.querySelector(".editor-table-body-viewport");
  const querySelectorResult10 = arg3.querySelector(".editor-table-body");
  if (!querySelectorResult4 || !querySelectorResult5 || !querySelectorResult6 || !querySelectorResult7 || !querySelectorResult8 || !querySelectorResult9 || !querySelectorResult10) {
    return;
  }
  const helperValue2 = () => {
    const memberValue11 = querySelectorResult10.scrollWidth;
    const maxResult12 = Math.max(0, querySelectorResult9.offsetWidth - querySelectorResult9.clientWidth);
    const flagValueoolean = Boolean(arg3.querySelector(".editor-section.is-base-editor-preview"));
    const selectedValue13 = flagValueoolean ? Math.max(memberValue11, querySelectorResult8.clientWidth + 160) : memberValue11;
    querySelectorResult5.style.width = selectedValue13 + "px";
    querySelectorResult6.style.paddingRight = 14 + maxResult12 + "px";
    const localValue14 = flagValueoolean || memberValue11 > querySelectorResult8.clientWidth + 2;
    querySelectorResult4.hidden = !localValue14;
    if (!localValue14) {
      querySelectorResult4.scrollLeft = 0;
      querySelectorResult7.scrollLeft = 0;
      querySelectorResult8.scrollLeft = 0;
    }
  };
  let textValue = "";
  const helperValue3 = (arg4, arg5) => {
    if (!textValue || textValue === arg4) {
      textValue = arg4;
      if (arg4 !== "sync") {
        querySelectorResult4.scrollLeft = arg5;
      }
      if (arg4 !== "header") {
        querySelectorResult7.scrollLeft = arg5;
      }
      if (arg4 !== "body") {
        querySelectorResult8.scrollLeft = arg5;
      }
      textValue = "";
    }
  };
  querySelectorResult4.addEventListener("scroll", () => helperValue3("sync", querySelectorResult4.scrollLeft));
  querySelectorResult7.addEventListener("scroll", () => helperValue3("header", querySelectorResult7.scrollLeft));
  querySelectorResult8.addEventListener("scroll", () => helperValue3("body", querySelectorResult8.scrollLeft));
  helperValue2();
  requestAnimationFrame(helperValue2);
  if (typeof ResizeObserver == "function") {
    const resizeObserverValue15 = new ResizeObserver(helperValue2);
    resizeObserverValue15.observe(querySelectorResult9);
    resizeObserverValue15.observe(querySelectorResult10);
  }
}
export function setupRowWheel(arg6) {
  const querySelectorResult16 = arg6.querySelector(".editor-table-body-viewport");
  const querySelectorResult17 = arg6.querySelector(".editor-table-body-scroller");
  if (querySelectorResult16) {
    requestAnimationFrame(() => {
      const fromResult18 = Array.from(querySelectorResult16.querySelectorAll("tbody tr"));
      if (!fromResult18.length) {
        return;
      }
      const memberValue19 = fromResult18[0];
      let localValue20;
      let localValue21;
      if (Boolean(querySelectorResult16.querySelector(".editor-preview-cell"))) {
        localValue20 = Math.ceil(258);
        localValue21 = 64;
      } else {
        const minResult22 = Math.min(4, fromResult18.length);
        const memberValue23 = fromResult18[minResult22 - 1];
        const numberValue = Number(memberValue19.offsetTop || 0);
        const localValue24 = Number(memberValue23.offsetTop || 0) + memberValue23.offsetHeight;
        const maxResult25 = Math.max(0, localValue24 - numberValue);
        const maxResult26 = Math.max(1, maxResult25 / minResult22);
        localValue20 = Math.ceil(maxResult25 + maxResult26 * (4 - minResult22) + 2);
        localValue21 = Math.ceil(memberValue19.getBoundingClientRect().height);
      }
      const querySelectorResult27 = arg6.querySelector(".editor-table-header-viewport");
      const closestResult28 = arg6.closest(".product-editor");
      let localValue = localValue20;
      if (closestResult28 && querySelectorResult27) {
        const localValue29 = closestResult28.getBoundingClientRect().height - querySelectorResult27.getBoundingClientRect().height - 40;
        if (localValue29 > localValue21) {
          localValue = Math.min(localValue20, Math.max(localValue21, localValue29));
        }
      }
      querySelectorResult16.style.flexBasis = localValue + "px";
      querySelectorResult16.style.minHeight = localValue21 + "px";
      querySelectorResult16.style.height = "";
      querySelectorResult16.style.maxHeight = "";
    });
    querySelectorResult16.addEventListener("wheel", (arg7) => {
      const helperValue4 = function (arg8) {
        const resultValue = helperFn(arg8.deltaX || 0, arg8);
        const resultValue2 = helperFn(arg8.deltaY || 0, arg8);
        if (Math.abs(resultValue) > Math.abs(resultValue2)) {
          return resultValue;
        } else if (arg8.shiftKey && Math.abs(resultValue2) > 0) {
          return resultValue2;
        } else {
          return 0;
        }
      }(arg7);
      if (querySelectorResult17 && helperValue4) {
        const maxResult30 = Math.max(0, querySelectorResult17.scrollWidth - querySelectorResult17.clientWidth);
        if (maxResult30 > 0) {
          arg7.preventDefault();
          querySelectorResult17.scrollLeft = Math.max(0, Math.min(maxResult30, querySelectorResult17.scrollLeft + helperValue4));
          return;
        }
      }
      arg7.preventDefault();
      const querySelectorResult31 = querySelectorResult16.querySelector("tbody tr");
      const selectedValue32 = querySelectorResult31 ? querySelectorResult31.getBoundingClientRect().height : 64;
      querySelectorResult16.scrollBy({
        top: (arg7.deltaY > 0 ? 1 : -1) * selectedValue32,
        behavior: "smooth"
      });
    }, {
      passive: false
    });
  }
}
export function setupTabNavigation(arg9) {
  const querySelectorResult33 = arg9.querySelector(".editor-table-body-viewport");
  if (querySelectorResult33) {
    querySelectorResult33.addEventListener("keydown", (arg10) => {
      if (arg10.key !== "Tab") {
        return;
      }
      const filterResult34 = [...querySelectorResult33.querySelectorAll("input.editor-cell-control, select.editor-cell-control")].filter((arg11) => !arg11.disabled);
      if (!filterResult34.length) {
        return;
      }
      const indexOfResult35 = filterResult34.indexOf(document.activeElement);
      if (indexOfResult35 < 0) {
        return;
      }
      arg10.preventDefault();
      const selectedValue36 = arg10.shiftKey ? indexOfResult35 - 1 : indexOfResult35 + 1;
      if (selectedValue36 >= 0 && selectedValue36 < filterResult34.length) {
        filterResult34[selectedValue36].focus();
        if (filterResult34[selectedValue36].select) {
          filterResult34[selectedValue36].select();
        }
      }
    });
  }
}
export function captureFocusInfo(arg12) {
  const memberValue37 = document.activeElement;
  if (!memberValue37 || !arg12.contains(memberValue37)) {
    return null;
  }
  const localValue38 = memberValue37.dataset?.rowIndex;
  const localValue39 = memberValue37.dataset?.fieldKey;
  if (localValue38 != null && localValue39) {
    return {
      rowIndex: String(localValue38),
      fieldKey: localValue39,
      selectionStart: memberValue37.selectionStart ?? null,
      selectionEnd: memberValue37.selectionEnd ?? null
    };
  } else {
    return null;
  }
}
export function restoreFocusInfo(arg13, arg14) {
  if (arg14) {
    requestAnimationFrame(() => {
      const querySelectorResult40 = arg13.querySelector(".editor-cell-control[data-row-index=\"" + arg14.rowIndex + "\"][data-field-key=\"" + arg14.fieldKey + "\"]");
      if (querySelectorResult40 && (querySelectorResult40.focus(), arg14.selectionStart != null && typeof querySelectorResult40.setSelectionRange == "function")) {
        try {
          querySelectorResult40.setSelectionRange(arg14.selectionStart, arg14.selectionEnd ?? arg14.selectionStart);
        } catch {}
      }
    });
  }
}
function helperFn(arg15, arg16) {
  if (arg15) {
    if (arg16.deltaMode === 1) {
      return arg15 * 16;
    } else if (arg16.deltaMode === 2) {
      return arg15 * 240;
    } else {
      return arg15;
    }
  } else {
    return 0;
  }
}
