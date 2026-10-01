import { isImageRelatedField, isSkuLikeField } from "./ozon/field-semantics.js";
import { getFieldColumnWidth, isLongTextField, parseCollectionFieldValue } from "./product-editor-display-rules.js";
export const SKU_PREFIX_FIELD_KEY = "__skuPrefix";
export function buildEditorFields(arg3) {
  return helperFn3(arg3).filter(([localValue4, localValue5]) => helperFn4(localValue4, localValue5)).map(([localValue6, localValue7], arg4) => ({
    fieldKey: localValue6,
    meta: localValue7,
    index: arg4,
    label: helperFn5(localValue6, localValue7),
    baseLabel: helperFn6(localValue6, localValue7),
    required: Boolean(localValue7?.required),
    isVariant: Boolean(localValue7?._isAspect),
    isLongText: isLongTextField(localValue7),
    width: getFieldColumnWidth(localValue7)
  })).sort(helperFn7);
}
export function findFirstMissingRequiredDraftField({
  drafts: resolvedValue6,
  templateMeta: resolvedValue7
} = {}) {
  const selectedValue8 = Array.isArray(resolvedValue6) ? resolvedValue6 : [];
  if (!selectedValue8.length) {
    return null;
  }
  const filterResult9 = buildEditorFields(resolvedValue7).filter((arg5) => arg5.required);
  for (const localValue10 of selectedValue8) {
    for (const localValue11 of filterResult9) {
      const localValue12 = localValue10?.fields?.[localValue11.fieldKey];
      if (helperFn9(localValue12, localValue11.meta)) {
        return {
          draft: localValue10,
          rowIndex: localValue10?.rowIndex,
          rowNumber: localValue10?.rowNumber,
          fieldKey: localValue11.fieldKey,
          label: localValue11.baseLabel || localValue11.label || localValue11.fieldKey
        };
      }
    }
  }
  return null;
}
export function getEditableFieldKeys(arg6) {
  return helperFn3(arg6).filter(([localValue13, localValue14]) => helperFn4(localValue13, localValue14) && localValue14.editable !== false).map(([localValue15]) => localValue15);
}
export function buildDraftIdentityKey(arg7) {
  const trimResult16 = String(arg7?.skuRowKey || "").trim();
  if (trimResult16) {
    return "sku:" + trimResult16;
  } else {
    return "row:" + String(arg7?.rowIndex ?? "");
  }
}
export function resolveDraftOfferId(arg8, arg9) {
  const findResult17 = Object.entries(arg8 && arg8.fields || {}).find(([localValue18]) => isSkuLikeField(localValue18, arg9 && arg9[localValue18] || {}));
  return String(findResult17 && findResult17[1] || arg8 && arg8.offerId || "").trim();
}
export function resolveDraftSkuPrefix(arg10) {
  if (arg10 && Object.prototype.hasOwnProperty.call(arg10, "skuPrefix")) {
    return String(arg10.skuPrefix || "").trim();
  } else {
    return helperFn2(arg10?.offerId).prefix;
  }
}
export function buildDraftOfferIdFromSkuPrefix(arg11, arg12, arg13 = 0) {
  const trimResult19 = String(arg12 || "").trim();
  const helperValue2 = function (arg14, arg15 = 0) {
    const memberValue20 = helperFn2(arg14?.offerId).suffix;
    if (memberValue20) {
      return memberValue20;
    }
    const numberValue = Number(arg14?.rowIndex);
    const selectedValue21 = Number.isFinite(numberValue) ? numberValue + 1 : Number(arg15) + 1;
    const selectedValue22 = Number.isFinite(selectedValue21) && selectedValue21 > 0 ? Math.floor(selectedValue21) : 1;
    return String(selectedValue22).padStart(2, "0");
  }(arg11, arg13);
  if (trimResult19) {
    return trimResult19 + "-" + helperValue2;
  } else {
    return helperValue2;
  }
}
export function applyDraftSkuCodeToFields(arg16, arg17, arg18) {
  const objectValue = {
    ...(arg16 || {})
  };
  getSkuCodeFieldKeys(arg17).forEach((arg19) => {
    objectValue[arg19] = arg18;
  });
  return objectValue;
}
export function getSkuCodeFieldKeys(arg20) {
  return Object.entries(arg20 || {}).filter(([localValue23, localValue24]) => isSkuLikeField(localValue23, localValue24 || {}) || String(localValue24?._systemFieldType || "") === "video_product").map(([localValue25]) => localValue25);
}
export function hasMeaningfulDraftValue(arg21) {
  return arg21 != null && (typeof arg21 == "number" ? Number.isFinite(arg21) : String(arg21).trim() !== "");
}
function helperFn2(arg22) {
  const trimResult26 = String(arg22 || "").trim();
  if (!trimResult26) {
    return {
      prefix: "",
      suffix: ""
    };
  }
  const filterResult27 = trimResult26.split("-").map((arg23) => String(arg23 || "").trim()).filter(Boolean);
  const findIndexResult28 = filterResult27.findIndex((arg24) => /^\d{8,14}$/.test(arg24));
  if (findIndexResult28 > 0) {
    return {
      prefix: filterResult27.slice(0, findIndexResult28).join("-"),
      suffix: filterResult27.slice(findIndexResult28).join("-")
    };
  }
  const matchResult29 = trimResult26.match(/^(.*)-(\d+)$/);
  const objectValue3 = {
    prefix: trimResult26,
    suffix: ""
  };
  if (matchResult29) {
    return {
      prefix: String(matchResult29[1] || "").trim(),
      suffix: String(matchResult29[2] || "").trim()
    };
  } else {
    return objectValue3;
  }
}
function helperFn3(arg25) {
  const selectedValue30 = arg25 && Array.isArray(arg25.editorOrder) ? arg25.editorOrder : null;
  if (selectedValue30 && selectedValue30.length) {
    return selectedValue30.map((arg26) => [arg26, arg25 && arg25.fieldMeta && arg25.fieldMeta[arg26] || {}]);
  } else {
    return Object.entries(arg25 && arg25.colMap || {}).sort((arg27, arg28) => arg27[1] - arg28[1]).map(([localValue31]) => [localValue31, arg25 && arg25.fieldMeta && arg25.fieldMeta[localValue31] || {}]);
  }
}
function helperFn4(arg29, arg30) {
  return !!arg30 && !arg30.frontendHidden && !function (arg31, arg32) {
    const stringValue = String(arg32?._systemFieldType || "");
    return stringValue === "video_title" || stringValue === "video_url" || stringValue === "video_cover_url" || stringValue === "video_product";
  }(0, arg30) && (arg30.displayReadOnly === true || arg30.editable !== false || !!String(arg30._systemFieldType || "").startsWith("video_")) && (arg30.displayReadOnly === true || !isImageRelatedField(arg29, arg30));
}
function helperFn5(arg33, arg34) {
  const resultValue = helperFn6(arg33, arg34);
  if (resultValue) {
    if (arg34?.required) {
      if (resultValue.startsWith("*")) {
        return resultValue;
      } else {
        return "*" + resultValue;
      }
    } else {
      return resultValue;
    }
  } else {
    return "";
  }
}
function helperFn6(arg35, arg36) {
  return String(arg36?.editorLabel || arg36?.header || (localValue32 = arg35, String(localValue32 || "").replace(/^\[|\]$/g, "")) || "").trim();
  var localValue32;
}
function helperFn7(arg37, arg38) {
  const arrayValue = helperFn8(arg37);
  const arrayValue2 = helperFn8(arg38);
  if (arrayValue !== arrayValue2) {
    return arrayValue - arrayValue2;
  } else {
    return arg37.index - arg38.index;
  }
}
function helperFn8(arg39) {
  if (arg39?.required) {
    return 0;
  } else if (arg39?.isVariant) {
    return 1;
  } else {
    return 2;
  }
}
function helperFn9(arg40, arg41) {
  if (arg41?.isCollection) {
    return parseCollectionFieldValue(arg40).length === 0;
  } else {
    return arg40 == null || (Array.isArray(arg40) ? arg40.map((arg42) => String(arg42 || "").trim()).filter(Boolean).length === 0 : String(arg40).trim() === "");
  }
}
