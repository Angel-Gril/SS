import { t } from "../../modules/i18n.js";

function text(key, fallback, substitutions) {
  return t(key, substitutions, fallback);
}
export function createPreviewController({
  els: resolvedValue1,
  text: resolvedValue2,
  getRoleLabel: resolvedValue3,
  getStatusLabel: resolvedValue4,
  getItems: resolvedValue5,
  onActiveChange: resolvedValue6
}) {
  const objectValue = {
    fkbYx: function (arg3, arg4, arg5) {
      return arg3?.(arg4, arg5);
    },
    mfjWd: function (arg6, arg7) {
      return arg6(arg7);
    },
    luSVb: function (arg8, arg9) {
      return arg8 < arg9;
    },
    USxmd: function (arg10, arg11) {
      return arg10 - arg11;
    },
    WJjJw: function (arg12) {
      return arg12();
    },
    qkODb: function (arg13, arg14) {
      return arg13(arg14);
    },
    DAiQO: function (arg15, arg16) {
      return arg15(arg16);
    },
    CfABU: function (arg17, arg18, arg19, arg20) {
      return arg17(arg18, arg19, arg20);
    },
    dsytU: function (arg21) {
      return arg21();
    },
    qUyDP: function (arg22, arg23) {
      return arg22 === arg23;
    },
    AIaWK: "xhhhI",
    YIaRE: "OOpqG",
    rCxRt: function (arg24) {
      return arg24();
    },
    oOwAo: function (arg25, arg26) {
      return arg25 <= arg26;
    },
    FlHae: function (arg27, arg28) {
      return arg27 >= arg28;
    }
  };
  let arrayValue = [];
  let textValue = "";
  function helperFn() {
    arrayValue = [];
    textValue = "";
    resolvedValue1.previewModal.hidden = true;
    resolvedValue1.previewImage.removeAttribute("src");
    resolvedValue1.previewTitle.textContent = resolvedValue2.previewTitle;
    resolvedValue1.previewDesc.textContent = "";
    if (resolvedValue1.previewCounter) {
      resolvedValue1.previewCounter.textContent = "";
      resolvedValue1.previewCounter.hidden = true;
    }
    helperFn5(null);
    objectValue.fkbYx(resolvedValue6, "", null);
  }
  function helperFn2() {
    return objectValue.mfjWd(Boolean, resolvedValue1.previewModal && !resolvedValue1.previewModal.hidden);
  }
  return {
    close: helperFn,
    isOpen: helperFn2,
    next: function () {
      if (!helperFn2()) {
        return;
      }
      const derivedValue7 = helperFn4();
      if (!objectValue.luSVb(derivedValue7, 0) && !(derivedValue7 >= objectValue.USxmd(arrayValue.length, 1))) {
        textValue = arrayValue[derivedValue7 + 1]?.id || textValue;
        objectValue.WJjJw(helperFn3);
      }
    },
    open: function (arg29) {
      const trimResult4 = objectValue.qkODb(String, arg29?.id || "").trim();
      const trimResult5 = String(arg29?.originalUrl || "").trim();
      arrayValue = objectValue.DAiQO(helperFn6, resolvedValue5?.() || []);
      textValue = objectValue.CfABU(helperFn9, arrayValue, trimResult4, trimResult5) || "";
      objectValue.dsytU(helperFn3);
      resolvedValue1.previewModal.hidden = false;
    },
    prev: function () {
      if (objectValue.qUyDP(objectValue.AIaWK, objectValue.YIaRE)) {
        const derivedValue8 = unboundValue8(unboundValue9);
        if (unboundValue10.isFinite(derivedValue8)) {
          return derivedValue8;
        } else {
          return unboundValue11.MAX_SAFE_INTEGER;
        }
      } else {
        if (!objectValue.rCxRt(helperFn2)) {
          return;
        }
        const dsytUResult6 = objectValue.dsytU(helperFn4);
        if (!objectValue.oOwAo(dsytUResult6, 0)) {
          textValue = arrayValue[dsytUResult6 - 1]?.id || textValue;
          helperFn3();
        }
      }
    },
    refresh: function () {
      if (objectValue.WJjJw(helperFn2)) {
        arrayValue = objectValue.qkODb(helperFn6, resolvedValue5?.() || []);
        textValue = helperFn9(arrayValue, textValue) || "";
        if (textValue) {
          helperFn3();
        } else {
          helperFn();
        }
      }
    }
  };
  function helperFn3() {
    const findResult7 = arrayValue.find((arg30) => arg30.id === textValue);
    if (!findResult7) {
      objectValue.WJjJw(helperFn);
      return;
    }
    const DAiQOResult8 = objectValue.DAiQO(resolvedValue3, findResult7);
    const qkODbResult9 = objectValue.qkODb(resolvedValue4, findResult7);
    var localValue10;
    resolvedValue1.previewImage.src = findResult7.currentUrl || findResult7.originalUrl;
    const textValue16 = text("previewTooltip_decisionLabel", "决策");
    const textValue17 = text("previewTooltip_reasonLabel", "原因");
    resolvedValue1.previewImage.title = (localValue10 = findResult7, ["ID: " + (localValue10?.id || "-"), textValue16 + ": " + (localValue10?.curationDecision || "-"), textValue17 + ": " + (localValue10?.curationReason || "-"), "URL: " + (localValue10?.originalUrl || "-")].join("\n"));
    resolvedValue1.previewTitle.textContent = resolvedValue2.previewTitle;
    const selectedValue11 = findResult7.manuallyReplaced ? " | " + resolvedValue2.replacedFile + ": " + (findResult7.replacementName || "-") : " | " + resolvedValue2.previewUpdated;
    resolvedValue1.previewDesc.textContent = "" + resolvedValue2.previewDesc(DAiQOResult8, qkODbResult9) + selectedValue11;
    const derivedValue12 = helperFn4();
    if (resolvedValue1.previewCounter) {
      resolvedValue1.previewCounter.textContent = derivedValue12 + 1 + " / " + arrayValue.length;
      resolvedValue1.previewCounter.hidden = objectValue.oOwAo(arrayValue.length, 1);
    }
    helperFn5(derivedValue12);
    objectValue.fkbYx(resolvedValue6, findResult7.id, findResult7);
  }
  function helperFn4() {
    return arrayValue.findIndex((arg31) => arg31.id === textValue);
  }
  function helperFn5(arg32) {
    if (!resolvedValue1.previewPrevBtn || !resolvedValue1.previewNextBtn) {
      return;
    }
    const localValue12 = arrayValue.length > 1;
    resolvedValue1.previewPrevBtn.hidden = !localValue12;
    resolvedValue1.previewNextBtn.hidden = !localValue12;
    resolvedValue1.previewPrevBtn.disabled = !localValue12 || arg32 <= 0;
    resolvedValue1.previewNextBtn.disabled = !localValue12 || objectValue.FlHae(arg32, arrayValue.length - 1);
  }
}
function helperFn6(arg33) {
  const selectedValue13 = Array.isArray(arg33) ? arg33 : [];
  return [...selectedValue13.filter((arg34) => String(arg34?.group || "") === "sku").sort((arg35, arg36) => {
    const rectValue = helperFn8(arg35?.skuRowIds?.[0]);
    const rectValue2 = helperFn8(arg36?.skuRowIds?.[0]);
    if (rectValue !== rectValue2) {
      return rectValue - rectValue2;
    } else {
      return Number(arg35?.createdAt || 0) - Number(arg36?.createdAt || 0);
    }
  }), ...selectedValue13.filter((arg37) => String(arg37?.group || "") === "gallery").sort((arg38, arg39) => {
    const targetValue = helperFn7(arg38?.sortOrder);
    const targetValue2 = helperFn7(arg39?.sortOrder);
    if (targetValue !== targetValue2) {
      return targetValue - targetValue2;
    } else {
      return Number(arg38?.createdAt || 0) - Number(arg39?.createdAt || 0);
    }
  })].filter((arg40) => {
    const trimResult14 = String(arg40?.currentUrl || arg40?.originalUrl || "").trim();
    return Boolean(trimResult14) && String(arg40?.id || "").trim();
  });
}
function helperFn7(arg41) {
  const numberValue = Number(arg41);
  if (Number.isFinite(numberValue)) {
    return numberValue;
  } else {
    return Number.MAX_SAFE_INTEGER;
  }
}
function helperFn8(arg42) {
  const numberValue2 = Number(arg42);
  if (Number.isFinite(numberValue2)) {
    return numberValue2;
  } else {
    return Number.MAX_SAFE_INTEGER;
  }
}
function helperFn9(arg43, arg44, arg45 = "") {
  if (arg44 && arg43.some((arg46) => arg46.id === arg44)) {
    return arg44;
  }
  if (arg45) {
    const findResult15 = arg43.find((arg47) => arg47.originalUrl === arg45);
    if (findResult15?.id) {
      return findResult15.id;
    }
  }
  return arg43[0]?.id || "";
}
