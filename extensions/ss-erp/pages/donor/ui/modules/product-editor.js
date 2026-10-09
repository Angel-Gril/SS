import { isAutoManagedMergeField as resolvedValue1, isImageRelatedField as resolvedValue2, isPackageDimensionField as resolvedValue3, isPackageWeightField as resolvedValue4 } from "./ozon/field-semantics.js";
import { getExpandableTextTooltip as resolvedValue5, getLongTextPreview as resolvedValue6, shouldUseExpandableTextPreviewCell as resolvedValue7 } from "./product-editor-display-rules.js";
import { applyDraftSkuCodeToFields as resolvedValue8, buildDraftOfferIdFromSkuPrefix as resolvedValue9, buildDraftIdentityKey as resolvedValue10, buildEditorFields as resolvedValue11, findFirstMissingRequiredDraftField as resolvedValue12, getEditableFieldKeys as resolvedValue13, getSkuCodeFieldKeys as resolvedValue14, hasMeaningfulDraftValue as resolvedValue15, resolveDraftOfferId as resolvedValue16, resolveDraftSkuPrefix as resolvedValue17, SKU_PREFIX_FIELD_KEY as resolvedValue18 } from "./product-editor-field-model.js";
import { createInlineControl as resolvedValue19 } from "./product-editor-inline-controls.js";
import { captureFocusInfo as resolvedValue20, restoreFocusInfo as resolvedValue21, setupRowWheel as resolvedValue22, setupScrollSync as resolvedValue23, setupTabNavigation as resolvedValue24 } from "./product-editor-table-behavior.js";
import { applyStickyColumn as resolvedValue25, createTableShell as resolvedValue26, FIXED_COLUMNS as resolvedValue27 } from "./product-editor-table-shell.js";
import { t } from "./i18n.js";
import { isDraftUploadEnabled as resolvedValue28, setDraftUploadEnabled as resolvedValue29, SKU_UPLOAD_ENABLED_FIELD_KEY as resolvedValue30 } from "./sku-upload-selection.js";
export { resolvedValue12 as findFirstMissingRequiredDraftField, helperFn7 as focusProductEditorField, resolvedValue13 as getEditableFieldKeys };
function text(key, fallback, substitutions) {
  return t(key, substitutions, fallback);
}
const stateObject8 = {
  editorOrder: ["价格，CNY", "折扣前价格，CNY", "毛重，克", "包装宽度，毫米", "包装高度，毫米", "包装长度，毫米"],
  fieldMeta: {
    "价格，CNY": {
      editorLabel: "价格，CNY",
      valueKind: "numeric",
      required: true,
      editable: true,
      _systemFieldType: "price"
    },
    "折扣前价格，CNY": {
      editorLabel: "折扣前价格，CNY",
      valueKind: "numeric",
      required: false,
      editable: true,
      _systemFieldType: "old_price"
    },
    "毛重，克": {
      editorLabel: "毛重，克",
      valueKind: "numeric",
      required: true,
      editable: true,
      _systemFieldType: "weight_g"
    },
    "包装宽度，毫米": {
      editorLabel: "包装宽度，毫米",
      valueKind: "numeric",
      required: true,
      editable: true,
      _systemFieldType: "width_mm"
    },
    "包装高度，毫米": {
      editorLabel: "包装高度，毫米",
      valueKind: "numeric",
      required: true,
      editable: true,
      _systemFieldType: "height_mm"
    },
    "包装长度，毫米": {
      editorLabel: "包装长度，毫米",
      valueKind: "numeric",
      required: true,
      editable: true,
      _systemFieldType: "depth_mm"
    }
  }
};
const namedValueLSDuplicateSku = "duplicateSku";
const namedValueLSSkuPrefix = "skuPrefix";
const vLS_manualDuplicate = "_manualDuplicate";
const localValue4 = new WeakMap();
export function renderProductEditor({
  container: resolvedValue31,
  drafts: resolvedValue32,
  templateMeta: resolvedValue33,
  onFieldChange: resolvedValue34,
  onOpenLongText: resolvedValue35 = null,
  onOpenAttributeSearch: resolvedValue36 = null
}) {
  if (!resolvedValue31) {
    return;
  }
  const derivedValue20 = resolvedValue20(resolvedValue31);
  (function (arg3) {
    const localValue5 = localValue4.get(arg3);
    if (localValue5) {
      localValue5.cancelled = true;
    }
    localValue4.delete(arg3);
  })(resolvedValue31);
  resolvedValue31.innerHTML = "";
  let derivedValue11 = resolvedValue11(resolvedValue33);
  const localValue6 = !derivedValue11.length;
  if (localValue6) {
    derivedValue11 = resolvedValue11(stateObject8);
  }
  if (!Array.isArray(resolvedValue32) || !resolvedValue32.length) {
    resolvedValue31.appendChild(function (arg4, {
      isBasePreview: resolvedValue37 = false
    } = {}) {
      const derivedValue26 = resolvedValue26(arg4);
      if (resolvedValue37) {
        derivedValue26.root.classList.add("is-base-editor-preview");
      }
      const localValue7 = derivedValue26.bodyTable.querySelector("tbody");
      const localValue8 = document.createElement("tr");
      const localValue9 = document.createElement("td");
      localValue9.colSpan = resolvedValue27.length + arg4.length;
      localValue9.className = "editor-preview-cell";
      localValue9.textContent = resolvedValue37 ? text("productEditor_basePreviewCategoryHint", "选择类目后，会在当前表格右侧追加类目字段。") : text("productEditor_basePreviewCollectedHint", "采集完成后，会把模板里的所有可填写列直接铺成一张横向表格。");
      localValue8.appendChild(localValue9);
      localValue7.appendChild(localValue8);
      return derivedValue26.root;
    }(derivedValue11, {
      isBasePreview: localValue6
    }));
    resolvedValue23(resolvedValue31);
    resolvedValue22(resolvedValue31);
    return;
  }
  const helperValue2 = function (arg5) {
    const stateObject9 = {
      cancelled: false
    };
    localValue4.set(arg5, stateObject9);
    return stateObject9;
  }(resolvedValue31);
  resolvedValue31.appendChild(function ({
    fields: resolvedValue38,
    drafts: resolvedValue39,
    activeFocusInfo: resolvedValue40,
    onFieldChange: resolvedValue41,
    onOpenLongText: resolvedValue42,
    onOpenAttributeSearch: resolvedValue43,
    renderJob: resolvedValue44
  }) {
    const objectValue10 = {
      drafts: resolvedValue39,
      onFieldChange: resolvedValue41
    };
    const derivedValue45 = resolvedValue26(resolvedValue38, objectValue10);
    (function ({
      bodyTbody: resolvedValue46,
      fields: resolvedValue47,
      drafts: resolvedValue48,
      activeFocusInfo: resolvedValue49,
      onFieldChange: resolvedValue50,
      onOpenLongText: resolvedValue51,
      onOpenAttributeSearch: resolvedValue52,
      renderJob: resolvedValue53
    }) {
      if (!resolvedValue46) {
        return;
      }
      const helperValue3 = function (arg6, arg7) {
        const localValue10 = Array.isArray(arg6) ? arg6.length : 0;
        const localValue11 = Array.isArray(arg7) ? arg7.length : 0;
        return localValue10 >= 60 || localValue10 * Math.max(localValue11, 1) >= 2500;
      }(resolvedValue48, resolvedValue47);
      let loopIndex0 = 0;
      const helperValue4 = () => {
        if (resolvedValue53?.cancelled) {
          return;
        }
        const localValue12 = typeof document.createDocumentFragment == "function" ? document.createDocumentFragment() : null;
        const localValue13 = helperValue3 ? Math.min(loopIndex0 + 24, resolvedValue48.length) : resolvedValue48.length;
        for (; loopIndex0 < localValue13; loopIndex0 += 1) {
          const objectValue11 = {
            draft: resolvedValue48[loopIndex0],
            index: loopIndex0,
            fields: resolvedValue47,
            activeFocusInfo: resolvedValue49,
            onFieldChange: resolvedValue50,
            onOpenLongText: resolvedValue51,
            onOpenAttributeSearch: resolvedValue52
          };
          const v$ = helperFn8(objectValue11);
          if (localValue12) {
            localValue12.appendChild(v$);
          } else {
            resolvedValue46.appendChild(v$);
          }
        }
        var localValue14;
        if (localValue12) {
          resolvedValue46.appendChild(localValue12);
        }
        if (loopIndex0 < resolvedValue48.length) {
          localValue14 = helperValue4;
          if (typeof requestAnimationFrame != "function") {
            setTimeout(localValue14, 0);
          } else {
            requestAnimationFrame(localValue14);
          }
        }
      };
      helperValue4();
    })({
      bodyTbody: derivedValue45.bodyTable.querySelector("tbody"),
      fields: resolvedValue38,
      drafts: resolvedValue39,
      activeFocusInfo: resolvedValue40,
      onFieldChange: resolvedValue41,
      onOpenLongText: resolvedValue42,
      onOpenAttributeSearch: resolvedValue43,
      renderJob: resolvedValue44
    });
    return derivedValue45.root;
  }({
    fields: derivedValue11,
    drafts: resolvedValue32,
    activeFocusInfo: derivedValue20,
    onFieldChange: resolvedValue34,
    onOpenLongText: resolvedValue35,
    onOpenAttributeSearch: resolvedValue36,
    renderJob: helperValue2
  }));
  resolvedValue23(resolvedValue31);
  resolvedValue22(resolvedValue31);
  resolvedValue24(resolvedValue31);
  resolvedValue21(resolvedValue31, derivedValue20);
}
export function patchProductEditorChange({
  container: resolvedValue54,
  drafts: resolvedValue55,
  templateMeta: resolvedValue56,
  change: resolvedValue57,
  onFieldChange: resolvedValue58,
  onOpenLongText: resolvedValue59 = null,
  onOpenAttributeSearch: resolvedValue60 = null
}) {
  if (!resolvedValue54 || !Array.isArray(resolvedValue55) || !resolvedValue55.length || !resolvedValue57) {
    return false;
  }
  if (!resolvedValue54.querySelector(".editor-table-body tbody")) {
    return false;
  }
  const derivedValue61 = resolvedValue11(resolvedValue56);
  if (!derivedValue61.length) {
    return false;
  }
  const localValue15 = resolvedValue56 && resolvedValue56.fieldMeta || {};
  const localValue16 = new Map(derivedValue61.map((arg8) => [arg8.fieldKey, arg8]));
  const objectValue12 = {
    container: resolvedValue54,
    fieldsByKey: localValue16,
    templateMeta: resolvedValue56,
    onFieldChange: resolvedValue58,
    onOpenLongText: resolvedValue59,
    onOpenAttributeSearch: resolvedValue60
  };
  if (resolvedValue57.scope === namedValueLSDuplicateSku) {
    return false;
  }
  if (resolvedValue57.scope === "skuUpload") {
    const localValue17 = resolvedValue55.findIndex((arg9) => String(arg9?.rowIndex) === String(resolvedValue57.rowIndex));
    if (!(localValue17 < 0)) {
      helperFn15({
        ...objectValue12,
        draft: resolvedValue55[localValue17]
      });
      helperFn16(resolvedValue54, resolvedValue55);
    }
    return true;
  }
  if (resolvedValue57.scope === "allSkuUpload") {
    resolvedValue55.forEach((arg10) => helperFn15({
      ...objectValue12,
      draft: arg10
    }));
    helperFn16(resolvedValue54, resolvedValue55);
    return true;
  }
  if (resolvedValue57.scope === namedValueLSSkuPrefix) {
    const localValue18 = resolvedValue55.findIndex((arg11) => String(arg11?.rowIndex) === String(resolvedValue57.rowIndex));
    if (localValue18 < 0) {
      return true;
    }
    const localValue19 = resolvedValue55[localValue18];
    const objectValue13 = {
      container: resolvedValue54,
      draft: localValue19,
      draftIndex: localValue18,
      onFieldChange: resolvedValue58
    };
    helperFn17(objectValue13);
    helperFn18({
      container: resolvedValue54,
      draft: localValue19,
      draftIndex: localValue18
    });
    resolvedValue14(resolvedValue56?.fieldMeta || {}).forEach((arg12) => {
      const objectValue14 = {
        ...objectValue12
      };
      objectValue14.draft = localValue19;
      objectValue14.fieldKey = arg12;
      helperFn14(objectValue14);
    });
    return true;
  }
  if (resolvedValue57.scope === "allRows") {
    if (resolvedValue57.fieldKey === resolvedValue18) {
      resolvedValue55.forEach((arg13, arg14) => {
        helperFn3(arg13, resolvedValue57.value, localValue15, arg14);
        helperFn17({
          container: resolvedValue54,
          draft: arg13,
          draftIndex: arg14,
          onFieldChange: resolvedValue58
        });
        helperFn18({
          container: resolvedValue54,
          draft: arg13,
          draftIndex: arg14
        });
        resolvedValue14(resolvedValue56?.fieldMeta || {}).forEach((arg15) => {
          const objectValue15 = {
            ...objectValue12
          };
          objectValue15.draft = arg13;
          objectValue15.fieldKey = arg15;
          helperFn14(objectValue15);
        });
      });
      return true;
    }
    const namedValueJ = helperFn13(resolvedValue57, resolvedValue56);
    resolvedValue55.forEach((arg16, arg17) => {
      namedValueJ.forEach((arg18) => {
        const objectValue16 = {
          ...objectValue12
        };
        objectValue16.draft = arg16;
        objectValue16.fieldKey = arg18;
        helperFn14(objectValue16);
      });
      helperFn18({
        container: resolvedValue54,
        draft: arg16,
        draftIndex: arg17
      });
    });
    return true;
  }
  if (resolvedValue57.scope === "sku") {
    const localValue20 = resolvedValue55.findIndex((arg19) => String(arg19?.rowIndex) === String(resolvedValue57.rowIndex));
    if (localValue20 < 0) {
      return true;
    }
    const localValue21 = resolvedValue55[localValue20];
    helperFn13(resolvedValue57, resolvedValue56).forEach((arg20) => {
      const objectValue17 = {
        ...objectValue12
      };
      objectValue17.draft = localValue21;
      objectValue17.fieldKey = arg20;
      helperFn14(objectValue17);
    });
    helperFn18({
      container: resolvedValue54,
      draft: localValue21,
      draftIndex: localValue20
    });
    return true;
  }
  return false;
}
export function mergeEditableDraftValues(arg21, arg22, arg23, arg24 = {}) {
  if (!Array.isArray(arg22) || !arg22.length) {
    return [];
  }
  const helperValue5 = function (arg25) {
    if (arg25 === "protected") {
      return "protected";
    }
    const localValue22 = typeof arg25 == "object" && arg25 ? String(arg25.preserveMode || arg25.mode || "").trim() : "";
    if (localValue22 === "protected" || localValue22 === "protectedFields") {
      return "protected";
    } else {
      return "all";
    }
  }(arg24);
  const localValue23 = helperValue5 === "protected";
  const localValue24 = new Set(resolvedValue13(arg23));
  const localValue25 = Array.isArray(arg21) ? arg21 : [];
  const localValue26 = new Map(localValue25.map((arg26) => [resolvedValue10(arg26), arg26]));
  const localValue27 = arg23 && arg23.fieldMeta || {};
  const localValue28 = arg22.map((arg27, arg28) => {
    const helperValue6 = function (arg29, arg30, arg31, arg32) {
      const localValue29 = arg29?.get?.(resolvedValue10(arg31));
      return localValue29 || Array.isArray(arg30) && arg30[arg32] || null;
    }(localValue26, localValue25, arg27, arg28);
    const helperValue7 = function (arg33, arg34, arg35) {
      if (helperFn(arg33)) {
        return arg33;
      }
      const localValue30 = Array.isArray(arg34) ? arg34[arg35] : null;
      if (helperFn(localValue30)) {
        return localValue30;
      } else {
        return null;
      }
    }(helperValue6, localValue25, arg28);
    if (!helperValue6 && !helperValue7) {
      return arg27;
    }
    const objectValue18 = {
      ...(arg27.fields || {})
    };
    let stateObject18 = objectValue18;
    if (helperValue6) {
      localValue24.forEach((arg36) => {
        const localValue31 = localValue27[arg36] || {};
        const localValue32 = helperValue6.fields?.[arg36];
        if (localValue23) {
          if (function (arg37, arg38) {
            return !!arg37?._manualEditedFields?.[arg38] && Boolean(arg37.fields && Object.prototype.hasOwnProperty.call(arg37.fields, arg38));
          }(helperValue6, arg36) || function (arg39, arg40 = {}) {
            const localValue33 = String(arg40?._systemFieldType || "").trim();
            return localValue33 === "price" || localValue33 === "old_price" || resolvedValue4(arg39, arg40) || resolvedValue3(arg39, arg40);
          }(arg36, localValue31) && function (arg41, arg42) {
            return !!arg41?.fields && !!Object.prototype.hasOwnProperty.call(arg41.fields, arg42) && (!!arg41._manualEditedFields?.[arg42] || resolvedValue15(arg41.fields[arg42]));
          }(helperValue6, arg36)) {
            stateObject18[arg36] = localValue32;
          }
        } else if (resolvedValue1(arg36, localValue31)) {
          if (resolvedValue2(arg36, localValue31)) {
            return;
          }
          if (resolvedValue15(localValue32)) {
            stateObject18[arg36] = localValue32;
          }
        } else if (Object.prototype.hasOwnProperty.call(helperValue6.fields || {}, arg36)) {
          stateObject18[arg36] = localValue32;
        }
      });
    }
    const objectValue19 = {
      ...arg27
    };
    objectValue19.fields = stateObject18;
    let derivedValue16 = resolvedValue16(objectValue19, localValue27);
    const objectValue20 = {
      ...arg27,
      uploadEnabled: resolvedValue28(helperValue6 || arg27),
      offerId: derivedValue16,
      fields: stateObject18,
      autoPricingOriginalFields: helperValue6?.autoPricingOriginalFields ? {
        ...helperValue6.autoPricingOriginalFields
      } : arg27.autoPricingOriginalFields,
      autoPricingSourceFields: helperValue6?.autoPricingSourceFields ? {
        ...helperValue6.autoPricingSourceFields
      } : arg27.autoPricingSourceFields,
      _manualEditedFields: helperValue6?._manualEditedFields ? {
        ...helperValue6._manualEditedFields
      } : arg27._manualEditedFields,
      pricing: helperValue6?.pricing ?? arg27.pricing
    };
    if (helperFn(helperValue7)) {
      const derivedValue17 = resolvedValue17(helperValue7);
      derivedValue16 = resolvedValue9(arg27, derivedValue17, arg27.rowIndex);
      stateObject18 = resolvedValue8(stateObject18, localValue27, derivedValue16);
      objectValue20.offerId = derivedValue16;
      objectValue20.fields = stateObject18;
      objectValue20.skuPrefix = derivedValue17;
      objectValue20._manualSkuPrefix = true;
    }
    return objectValue20;
  });
  (function (arg43, arg44, arg45 = {}) {
    const localValue34 = (arg43 || []).filter((arg46) => Boolean(arg46?.[vLS_manualDuplicate]));
    if (!localValue34.length) {
      return;
    }
    const localValue35 = arg45?.skuMediaMap || null;
    const localValue36 = new Set(arg44.map((arg47) => String(arg47?.rowIndex)));
    const localValue37 = new Set(arg44.map((arg48) => String(arg48?.skuRowKey || "").trim()).filter(Boolean));
    let namedValueQ = helperFn5(arg44);
    localValue34.forEach((arg49) => {
      const namedValueU = helperFn6(arg49);
      if (!namedValueU || typeof namedValueU != "object") {
        return;
      }
      if (localValue36.has(String(namedValueU.rowIndex))) {
        while (localValue36.has(String(namedValueQ))) {
          namedValueQ += 1;
        }
        namedValueU.rowIndex = namedValueQ;
      }
      localValue36.add(String(namedValueU.rowIndex));
      const localValue38 = String(namedValueU.skuRowKey || "").trim();
      if (!localValue38 || !!localValue37.has(localValue38)) {
        namedValueU.skuRowKey = helperFn4(localValue38 || namedValueU._manualDuplicateSourceSkuRowKey || "row_" + namedValueU.rowIndex, localValue37);
      }
      (function (arg50, arg51) {
        if (arg51) {
          arg50.media = {
            ...(arg50.media || {}),
            mainImage: arg51.mainImage || "",
            extraImages: Array.isArray(arg51.extraImages) ? [...arg51.extraImages] : [],
            richContentImages: Array.isArray(arg51.richContentImages) ? [...arg51.richContentImages] : [],
            richContentVideoUrl: arg51.richContentVideoUrl || arg50.media?.richContentVideoUrl || "",
            colorSample: arg51.colorSample || arg50.media?.colorSample || ""
          };
        }
      })(namedValueU, localValue35?.bySkuRowKey?.[namedValueU.skuRowKey]);
      localValue37.add(String(namedValueU.skuRowKey || "").trim());
      arg44.push(namedValueU);
    });
  })(arg21, localValue28, arg24);
  return localValue28;
}
export function applyDraftFieldChange(arg52, arg53, arg54) {
  if (!Array.isArray(arg52) || !arg53) {
    return arg52 || [];
  }
  const localValue39 = arg54 && arg54.fieldMeta || {};
  if (arg53.scope === namedValueLSDuplicateSku) {
    (function (arg55, arg56) {
      const localValue40 = arg55.findIndex((arg57) => String(arg57?.rowIndex) === String(arg56.rowIndex));
      if (localValue40 < 0) {
        return null;
      }
      const localValue41 = arg55[localValue40];
      const namedValueQ2 = helperFn5(arg55);
      const namedValueU2 = helperFn6(localValue41);
      namedValueU2.rowIndex = namedValueQ2;
      namedValueU2.rowNumber = function (arg58) {
        const localValue42 = (arg58 || []).reduce((arg59, arg60) => {
          const numberValue = Number(arg60?.rowNumber);
          if (Number.isFinite(numberValue)) {
            return Math.max(arg59, Math.floor(numberValue));
          } else {
            return arg59;
          }
        }, 0) + 1;
        return localValue42 || (arg58 || []).length + 1;
      }(arg55);
      namedValueU2.sourceRowIndex = localValue41.sourceRowIndex ?? localValue41.rowIndex;
      namedValueU2.skuRowKey = function (arg61, arg62, arg63) {
        const localValue43 = new Set((arg62 || []).map((arg64) => String(arg64?.skuRowKey || "").trim()).filter(Boolean));
        return helperFn4(String(arg61?.skuRowKey || "row_" + arg63).trim(), localValue43);
      }(localValue41, arg55, namedValueQ2);
      namedValueU2[vLS_manualDuplicate] = true;
      namedValueU2._manualDuplicateSourceRowIndex = localValue41.sourceRowIndex ?? localValue41.rowIndex ?? "";
      namedValueU2._manualDuplicateSourceSkuRowKey = String(localValue41.skuRowKey || "").trim();
      namedValueU2._manualDuplicateCreatedAt = Date.now();
      arg55.splice(localValue40 + 1, 0, namedValueU2);
      arg56.sourceRowIndex = namedValueU2.sourceRowIndex;
      arg56.sourceSkuRowKey = String(localValue41.skuRowKey || "").trim();
      arg56.duplicatedRowIndex = namedValueU2.rowIndex;
      arg56.duplicatedSkuRowKey = namedValueU2.skuRowKey;
    })(arg52, arg53);
    return arg52;
  }
  if (arg53.scope === "skuUpload") {
    const localValue44 = arg52.find((arg65) => arg65.rowIndex === arg53.rowIndex);
    resolvedValue29(localValue44, arg53.value ?? arg53.uploadEnabled);
    return arg52;
  }
  if (arg53.scope === "allSkuUpload") {
    const localValue45 = arg53.value ?? arg53.uploadEnabled;
    arg52.forEach((arg66) => resolvedValue29(arg66, localValue45));
    return arg52;
  }
  if (arg53.scope === namedValueLSSkuPrefix) {
    const localValue46 = arg52.findIndex((arg67) => String(arg67?.rowIndex) === String(arg53.rowIndex));
    const localValue47 = localValue46 >= 0 ? arg52[localValue46] : null;
    if (localValue47) {
      helperFn3(localValue47, arg53.value, localValue39, localValue46);
    }
    return arg52;
  }
  if (arg53.scope === "allRows") {
    if (arg53.fieldKey === resolvedValue18) {
      arg52.forEach((arg68, arg69) => {
        helperFn3(arg68, arg53.value, localValue39, arg69);
      });
      return arg52;
    } else {
      arg52.forEach((arg70) => {
        arg70.fields = {
          ...(arg70.fields || {}),
          [arg53.fieldKey]: arg53.value
        };
        helperFn2(arg70, arg53.fieldKey);
        const localValue48 = localValue39[arg53.fieldKey];
        if (localValue48?._systemFieldType === "price") {
          const localValue49 = parseFloat(String(arg53.value).replace(/[^\d.]/g, "")) || 0;
          const localValue50 = Object.keys(localValue39).find((arg71) => localValue39[arg71]._systemFieldType === "old_price");
          if (localValue50) {
            arg70.fields[localValue50] = localValue49 > 0 ? String(Math.round(localValue49 * 2)) : "";
            helperFn2(arg70, localValue50);
          }
        }
        arg70.offerId = resolvedValue16(arg70, localValue39);
      });
      return arg52;
    }
  }
  const localValue51 = arg52.find((arg72) => arg72.rowIndex === arg53.rowIndex);
  if (!localValue51) {
    return arg52;
  }
  localValue51.fields = {
    ...(localValue51.fields || {}),
    [arg53.fieldKey]: arg53.value
  };
  helperFn2(localValue51, arg53.fieldKey);
  const localValue52 = localValue39[arg53.fieldKey];
  if (localValue52?._systemFieldType === "price") {
    const localValue53 = parseFloat(String(arg53.value).replace(/[^\d.]/g, "")) || 0;
    const localValue54 = Object.keys(localValue39).find((arg73) => localValue39[arg73]._systemFieldType === "old_price");
    if (localValue54) {
      localValue51.fields[localValue54] = localValue53 > 0 ? String(Math.round(localValue53 * 2)) : "";
      helperFn2(localValue51, localValue54);
    }
  }
  localValue51.offerId = resolvedValue16(localValue51, localValue39);
  return arg52;
}
export function isDraftPricingWarningField(arg74, arg75, arg76) {
  const localValue55 = String(arg75?.pricing?.warningType || "").trim();
  if (localValue55 !== "offset_dimension_limit" && localValue55 !== "no_valid_route" && localValue55 !== "missing_packaging" && localValue55 !== "missing_input") {
    return false;
  }
  const localValue56 = arg76?.fieldMeta?.[arg74] || {};
  return (!!resolvedValue4(arg74, localValue56) || !!resolvedValue3(arg74, localValue56)) && (localValue55 !== "missing_packaging" && localValue55 !== "missing_input" || function (arg77) {
    const localValue57 = Number.parseFloat(String(arg77 ?? "").replace(/[^\d.-]/g, ""));
    if (Number.isFinite(localValue57) && localValue57 > 0) {
      return localValue57;
    } else {
      return 0;
    }
  }(arg75?.fields?.[arg74]) <= 0);
}
function helperFn(arg78) {
  return Boolean(arg78 && (arg78._manualSkuPrefix || Object.prototype.hasOwnProperty.call(arg78, "skuPrefix")));
}
function helperFn2(arg79, arg80) {
  if (arg79 && arg80) {
    arg79._manualEditedFields = {
      ...(arg79._manualEditedFields || {}),
      [arg80]: true
    };
  }
}
function helperFn3(arg81, arg82, arg83, arg84) {
  const localValue58 = String(arg82 ?? "").trim();
  const derivedValue9 = resolvedValue9(arg81, localValue58, arg84);
  arg81.skuPrefix = localValue58;
  arg81._manualSkuPrefix = true;
  arg81.offerId = derivedValue9;
  arg81.fields = resolvedValue8(arg81.fields || {}, arg83, derivedValue9);
}
function helperFn4(arg85, arg86) {
  const localValue59 = String(arg85 || "sku").trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "sku";
  for (let loopIndex1 = 1; loopIndex1 < 10000; loopIndex1 += 1) {
    const localValue60 = localValue59 + "__copy_" + loopIndex1;
    if (!arg86.has(localValue60)) {
      return localValue60;
    }
  }
  return localValue59 + "__copy_" + Date.now();
}
function helperFn5(arg87) {
  return (arg87 || []).reduce((arg88, arg89) => {
    const numberValue2 = Number(arg89?.rowIndex);
    if (Number.isFinite(numberValue2)) {
      return Math.max(arg88, Math.floor(numberValue2));
    } else {
      return arg88;
    }
  }, -1) + 1;
}
function helperFn6(arg90) {
  if (Array.isArray(arg90)) {
    return arg90.map((arg91) => helperFn6(arg91));
  } else if (arg90 && typeof arg90 == "object") {
    return Object.fromEntries(Object.entries(arg90).map(([localValue61, localValue62]) => [localValue61, helperFn6(localValue62)]));
  } else {
    return arg90;
  }
}
function helperFn7({
  container: resolvedValue62,
  rowIndex: resolvedValue63,
  fieldKey: resolvedValue64
} = {}) {
  if (!resolvedValue62 || resolvedValue64 == null) {
    return false;
  }
  const helperValue8 = function (arg92, arg93, arg94) {
    return Array.from(arg92.querySelectorAll("[data-field-key]")).find((arg95) => String(arg95?.dataset?.fieldKey || "") === String(arg94 || "") && (arg93 == null || String(arg95?.dataset?.rowIndex || "") === String(arg93))) || null;
  }(resolvedValue62, resolvedValue63, resolvedValue64);
  const localValue62 = text("productEditor_requiredFieldEmpty", "必填项不能为空");
  return !!helperValue8 && (helperValue8.classList?.add?.("is-required-missing"), helperValue8.setAttribute?.("aria-invalid", "true"), helperValue8.title = helperValue8.title ? helperValue8.title + text("productEditor_titleSeparator", "；") + localValue62 : localValue62, helperValue8.scrollIntoView?.({
    block: "center",
    inline: "center",
    behavior: "smooth"
  }), helperValue8.focus?.({
    preventScroll: true
  }), helperValue8.select?.(), true);
}
function helperFn8({
  draft: resolvedValue65,
  index: resolvedValue66,
  fields: resolvedValue67,
  activeFocusInfo: resolvedValue68,
  onFieldChange: resolvedValue69,
  onOpenLongText: resolvedValue70,
  onOpenAttributeSearch: resolvedValue71
}) {
  const objectValue21 = {
    pDcqw: function (arg96, arg97) {
      return arg96?.(arg97);
    },
    dKKVc: "editor-table-copy",
    JcuXf: "button",
    wIgfP: "editor-row-copy-btn",
    IXDRA: text("productEditor_duplicateSkuTitle", "复制一份相同 SKU"),
    NXhdq: "click",
    Glyml: function (arg98, arg99, arg100, arg101) {
      return arg98(arg99, arg100, arg101);
    },
    RQjqe: function (arg102, arg103) {
      return arg102(arg103);
    },
    sPCuP: function (arg104, arg105, arg106, arg107) {
      return arg104(arg105, arg106, arg107);
    },
    PocSd: "img",
    JRSFg: "editor-thumb",
    cfZBy: "SKU",
    eWrCa: function (arg108, arg109, arg110, arg111) {
      return arg108(arg109, arg110, arg111);
    },
    fauuJ: function (arg112, arg113) {
      return arg112(arg113);
    },
    ZvLwd: function (arg114, arg115, arg116, arg117) {
      return arg114(arg115, arg116, arg117);
    }
  };
  const localValue63 = document.createElement("tr");
  localValue63.dataset.editorRowIndex = String(resolvedValue65.rowIndex);
  localValue63.dataset.editorDraftIndex = String(resolvedValue66);
  const localValue64 = objectValue21.fauuJ(resolvedValue28, resolvedValue65);
  if (!localValue64) {
    localValue63.className = "is-upload-disabled";
  }
  localValue63.appendChild(helperFn9(resolvedValue65, localValue64, resolvedValue69));
  localValue63.appendChild(function (arg118, arg119) {
    const localValue65 = document.createElement("td");
    localValue65.className = objectValue21.dKKVc;
    const localValue66 = document.createElement("button");
    localValue66.type = objectValue21.JcuXf;
    localValue66.className = objectValue21.wIgfP;
    localValue66.textContent = text("productEditor_columnDuplicate", "复制");
    localValue66.title = objectValue21.IXDRA;
    localValue66.disabled = !arg119;
    localValue66.dataset.rowIndex = String(arg118.rowIndex);
    localValue66.addEventListener(objectValue21.NXhdq, () => {
      objectValue21.pDcqw(arg119, {
        scope: namedValueLSDuplicateSku,
        rowIndex: Number(localValue66.dataset.rowIndex)
      });
    });
    localValue65.appendChild(localValue66);
    objectValue21.Glyml(resolvedValue25, localValue65, 1, false);
    return localValue65;
  }(resolvedValue65, resolvedValue69));
  localValue63.appendChild(function (arg120) {
    const localValue67 = document.createElement("td");
    localValue67.className = "editor-table-index";
    localValue67.textContent = objectValue21.RQjqe(String, arg120 + 1);
    objectValue21.sPCuP(resolvedValue25, localValue67, 2, false);
    return localValue67;
  }(resolvedValue66));
  localValue63.appendChild(objectValue21.ZvLwd(helperFn10, resolvedValue65, 0, resolvedValue69));
  localValue63.appendChild(helperFn11(resolvedValue65, resolvedValue66));
  localValue63.appendChild(function (arg121) {
    const localValue68 = document.createElement("td");
    localValue68.className = "editor-table-image";
    const localValue69 = document.createElement(objectValue21.PocSd);
    localValue69.className = objectValue21.JRSFg;
    localValue69.alt = objectValue21.cfZBy;
    localValue69.loading = "lazy";
    localValue69.decoding = "async";
    if (arg121.imageCrossOrigin === 'anonymous') localValue69.crossOrigin = 'anonymous';
    localValue69.referrerPolicy = 'no-referrer';
    localValue69.src = arg121.media && (arg121.media.mainImage || arg121.media.colorSample) || arg121.sourceImageUrl || "";
    localValue68.appendChild(localValue69);
    objectValue21.eWrCa(resolvedValue25, localValue68, 5, false);
    return localValue68;
  }(resolvedValue65));
  resolvedValue67.forEach((arg122) => {
    const objectValue22 = {
      field: arg122,
      draft: resolvedValue65,
      activeFocusInfo: resolvedValue68,
      onFieldChange: resolvedValue69,
      onOpenLongText: resolvedValue70,
      onOpenAttributeSearch: resolvedValue71
    };
    localValue63.appendChild(helperFn12(objectValue22));
  });
  return localValue63;
}
function helperFn9(arg123, arg124, arg125) {
  const objectValue23 = {
    NybuW: function (arg126, arg127) {
      return arg126?.(arg127);
    },
    gBtJv: function (arg128, arg129) {
      return arg128(arg129);
    },
    oGbXl: "checkbox",
    gbDRM: text("productEditor_cancelSkuUploadTitle", "取消上传这个 SKU"),
    GLZIt: text("productEditor_restoreSkuUploadTitle", "恢复上传这个 SKU"),
    jRnzr: "change",
    ohiyq: function (arg130, arg131, arg132, arg133) {
      return arg130(arg131, arg132, arg133);
    }
  };
  const localValue70 = document.createElement("td");
  localValue70.className = "editor-table-upload-check";
  const localValue71 = document.createElement("input");
  localValue71.type = objectValue23.oGbXl;
  localValue71.className = "editor-row-upload-checkbox";
  localValue71.checked = arg124;
  localValue71.dataset.rowIndex = String(arg123.rowIndex);
  localValue71.title = arg124 ? objectValue23.gbDRM : objectValue23.GLZIt;
  localValue71.disabled = !arg125;
  localValue71.addEventListener(objectValue23.jRnzr, () => {
    objectValue23.NybuW(arg125, {
      scope: "skuUpload",
      fieldKey: resolvedValue30,
      rowIndex: objectValue23.gBtJv(Number, localValue71.dataset.rowIndex),
      value: localValue71.checked
    });
  });
  localValue70.appendChild(localValue71);
  objectValue23.ohiyq(resolvedValue25, localValue70, 0, false);
  return localValue70;
}
function helperFn10(arg134, arg135, arg136) {
  const objectValue24 = {
    xSqXZ: function (arg137, arg138) {
      return arg137?.(arg138);
    },
    namedValueJgAn: function (arg139, arg140) {
      return arg139 >= arg140;
    },
    kwFlh: function (arg141, arg142) {
      return arg141(arg142);
    },
    KJXHK: "input"
  };
  const localValue72 = document.createElement("td");
  localValue72.className = "editor-table-sku-prefix";
  const localValue73 = document.createElement(objectValue24.KJXHK);
  localValue73.type = "text";
  localValue73.className = "editor-sku-prefix-input";
  localValue73.value = resolvedValue17(arg134);
  localValue73.dataset.rowIndex = String(arg134.rowIndex);
  localValue73.dataset.fieldKey = resolvedValue18;
  localValue73.title = text("productEditor_editSkuPrefixTitle", "编辑这个 SKU 的货号前缀");
  localValue73.placeholder = "SKU";
  localValue73.disabled = !arg136;
  const helperValue9 = (arg143 = {}) => {
    objectValue24.xSqXZ(arg136, {
      scope: namedValueLSSkuPrefix,
      rowIndex: Number(localValue73.dataset.rowIndex),
      fieldKey: resolvedValue18,
      value: localValue73.value,
      ...arg143
    });
  };
  localValue73.addEventListener(objectValue24.KJXHK, () => {
    const objectValue25 = {
      WKJMB: function (arg144, arg145) {
        return objectValue24.namedValueJgAn(arg144, arg145);
      }
    };
    objectValue24.kwFlh(helperValue9, {
      live: true,
      render: false
    });
  });
  localValue73.addEventListener("change", () => {
    helperValue9();
  });
  localValue72.appendChild(localValue73);
  resolvedValue25(localValue72, 3, false);
  return localValue72;
}
function helperFn11(arg146, arg147) {
  const localValue74 = document.createElement("td");
  localValue74.className = "editor-table-spec";
  const localValue75 = String(arg146.sourceSpec || arg146.offerId || "SKU " + (arg147 + 1)).trim();
  const localValue76 = String(arg146.offerId || "").trim();
  localValue74.innerHTML = "<strong>" + helperFn21(localValue75) + "</strong><span>" + helperFn21(localValue76) + "</span>";
  localValue74.title = [localValue75, localValue76].filter(Boolean).join("\n");
  resolvedValue25(localValue74, 4, false);
  return localValue74;
}
function helperFn12({
  field: resolvedValue72,
  draft: resolvedValue73,
  activeFocusInfo: resolvedValue74,
  onFieldChange: resolvedValue75,
  onOpenLongText: resolvedValue76
}) {
  const localValue77 = document.createElement("td");
  localValue77.className = "editor-table-cell";
  localValue77.dataset.editorRowIndex = String(resolvedValue73.rowIndex);
  localValue77.dataset.editorFieldKey = resolvedValue72.fieldKey;
  const localValue78 = resolvedValue73.fields && resolvedValue72.fieldKey in resolvedValue73.fields ? resolvedValue73.fields[resolvedValue72.fieldKey] : "";
  const namedValueIsDraftPricingWarningField = isDraftPricingWarningField(resolvedValue72.fieldKey, resolvedValue73, {
    fieldMeta: {
      [resolvedValue72.fieldKey]: resolvedValue72.meta
    }
  });
  if (namedValueIsDraftPricingWarningField) {
    localValue77.classList.add("has-pricing-warning");
    localValue77.title = resolvedValue73?.pricing?.warningMessage || text("productEditor_packagingWarning", "请检查包装重量和尺寸。");
  }
  const localValue79 = (!resolvedValue74 || String(resolvedValue74.rowIndex) !== String(resolvedValue73.rowIndex) || resolvedValue74.fieldKey !== resolvedValue72.fieldKey) && resolvedValue7(resolvedValue72.meta, localValue78);
  if (resolvedValue72.isLongText || localValue79) {
    localValue77.classList.add("is-long-text");
  }
  if (resolvedValue72.isLongText) {
    localValue77.appendChild(function ({
      field: resolvedValue77,
      draft: resolvedValue78,
      value: resolvedValue79,
      onOpenLongText: resolvedValue80
    }) {
      const localValue80 = document.createElement("div");
      localValue80.className = "editor-cell-long";
      const localValue81 = document.createElement("button");
      localValue81.type = "button";
      localValue81.className = "editor-cell-preview";
      localValue81.textContent = resolvedValue6(resolvedValue79);
      localValue81.title = resolvedValue5(resolvedValue79);
      localValue81.disabled = !resolvedValue80;
      localValue81.addEventListener("click", () => {
        const objectValue27 = {
          scope: "sku",
          rowIndex: resolvedValue78.rowIndex,
          fieldKey: resolvedValue77.fieldKey,
          value: resolvedValue79,
          label: resolvedValue77.label
        };
        if (resolvedValue80) {
          resolvedValue80(objectValue27);
        }
      });
      localValue80.appendChild(localValue81);
      return localValue80;
    }({
      field: resolvedValue72,
      draft: resolvedValue73,
      value: localValue78,
      onOpenLongText: resolvedValue76
    }));
    return localValue77;
  }
  if (localValue79) {
    localValue77.appendChild(function ({
      field: resolvedValue81,
      draft: resolvedValue82,
      value: resolvedValue83,
      onOpenLongText: resolvedValue84
    }) {
      const localValue82 = document.createElement("div");
      localValue82.className = "editor-cell-long";
      localValue82.style.minWidth = "0";
      const localValue83 = document.createElement("button");
      localValue83.type = "button";
      localValue83.className = "editor-cell-preview";
      localValue83.textContent = resolvedValue6(resolvedValue83);
      localValue83.title = resolvedValue5(resolvedValue83);
      localValue83.disabled = !resolvedValue84;
      localValue83.addEventListener("click", () => {
        const objectValue28 = {
          scope: "sku",
          rowIndex: resolvedValue82.rowIndex,
          fieldKey: resolvedValue81.fieldKey,
          value: resolvedValue83,
          label: resolvedValue81.label
        };
        if (resolvedValue84) {
          resolvedValue84(objectValue28);
        }
      });
      localValue82.appendChild(localValue83);
      return localValue82;
    }({
      field: resolvedValue72,
      draft: resolvedValue73,
      value: localValue78,
      onOpenLongText: resolvedValue76
    }));
    return localValue77;
  }
  const derivedValue19 = resolvedValue19(resolvedValue72.meta, localValue78);
  derivedValue19.classList.add("editor-cell-control");
  if (namedValueIsDraftPricingWarningField) {
    derivedValue19.classList.add("is-pricing-warning");
    derivedValue19.setAttribute("aria-invalid", "true");
    derivedValue19.title = resolvedValue73?.pricing?.warningMessage || text("productEditor_packagingWarning", "请检查包装重量和尺寸。");
  }
  derivedValue19.dataset.rowIndex = String(resolvedValue73.rowIndex);
  derivedValue19.dataset.fieldKey = resolvedValue72.fieldKey;
  if (resolvedValue75) {
    const helperValue10 = (arg148 = {}) => {
      resolvedValue75({
        scope: "sku",
        rowIndex: Number(derivedValue19.dataset.rowIndex),
        fieldKey: resolvedValue72.fieldKey,
        value: derivedValue19.value,
        ...arg148
      });
    };
    derivedValue19.addEventListener("change", () => {
      helperValue10();
    });
    if (derivedValue19.tagName === "INPUT") {
      derivedValue19.addEventListener("input", () => {
        helperValue10({
          live: true,
          render: false
        });
      });
    }
  } else if (derivedValue19.tagName === "DIV") {
    derivedValue19.style.pointerEvents = "none";
    derivedValue19.style.opacity = "0.5";
  } else {
    derivedValue19.disabled = true;
  }
  localValue77.appendChild(derivedValue19);
  return localValue77;
}
function helperFn13(arg149, arg150) {
  const localValue84 = new Set();
  if (arg149?.fieldKey) {
    localValue84.add(arg149.fieldKey);
  }
  Object.entries(arg150?.fieldMeta || {}).forEach(([localValue85, localValue86]) => {
    const stringValue = String(localValue86?._systemFieldType || "");
    if (stringValue === "price" || stringValue === "old_price") {
      localValue84.add(localValue85);
    }
  });
  return [...localValue84];
}
function helperFn14({
  container: resolvedValue85,
  fieldsByKey: resolvedValue86,
  draft: resolvedValue87,
  fieldKey: resolvedValue88,
  onFieldChange: resolvedValue89,
  onOpenLongText: resolvedValue90,
  onOpenAttributeSearch: resolvedValue91
}) {
  const localValue87 = resolvedValue86.get(resolvedValue88);
  if (!localValue87) {
    return false;
  }
  const helperValue11 = function (arg151, arg152) {
    if (!arg151) {
      return null;
    }
    const stringValue2 = String(arg152 || "");
    return [...arg151.querySelectorAll("td[data-editor-field-key]")].find((arg153) => String(arg153.dataset.editorFieldKey || "") === stringValue2) || null;
  }(helperFn19(resolvedValue85, resolvedValue87?.rowIndex), resolvedValue88);
  const objectValue30 = {
    field: localValue87,
    draft: resolvedValue87,
    activeFocusInfo: null,
    onFieldChange: resolvedValue89,
    onOpenLongText: resolvedValue90,
    onOpenAttributeSearch: resolvedValue91
  };
  return !!helperValue11 && (helperFn20(helperValue11, helperFn12(objectValue30)), true);
}
function helperFn15({
  container: resolvedValue92,
  draft: resolvedValue93,
  onFieldChange: resolvedValue94
}) {
  const namedValueX = helperFn19(resolvedValue92, resolvedValue93?.rowIndex);
  if (!namedValueX) {
    return false;
  }
  const derivedValue28 = resolvedValue28(resolvedValue93);
  namedValueX.classList.toggle("is-upload-disabled", !derivedValue28);
  const localValue88 = namedValueX.children[0];
  return !!localValue88 && (helperFn20(localValue88, helperFn9(resolvedValue93, derivedValue28, resolvedValue94)), true);
}
function helperFn16(arg154, arg155) {
  const localValue89 = arg154.querySelector(".editor-upload-all-checkbox");
  if (!localValue89) {
    return;
  }
  const localValue90 = Array.isArray(arg155) ? arg155 : [];
  const localValue91 = localValue90.filter((arg156) => resolvedValue28(arg156)).length;
  localValue89.checked = localValue90.length > 0 && localValue91 === localValue90.length;
  localValue89.indeterminate = localValue91 > 0 && localValue91 < localValue90.length;
}
function helperFn17({
  container: resolvedValue95,
  draft: resolvedValue96,
  onFieldChange: resolvedValue97
}) {
  const namedValueX2 = helperFn19(resolvedValue95, resolvedValue96?.rowIndex);
  if (!namedValueX2) {
    return false;
  }
  const localValue92 = namedValueX2.children[3];
  return !!localValue92 && (helperFn20(localValue92, helperFn10(resolvedValue96, 0, resolvedValue97)), true);
}
function helperFn18({
  container: resolvedValue98,
  draft: resolvedValue99,
  draftIndex: resolvedValue100
}) {
  const namedValueX3 = helperFn19(resolvedValue98, resolvedValue99?.rowIndex);
  if (!namedValueX3) {
    return false;
  }
  const localValue93 = namedValueX3.children[4];
  return !!localValue93 && (helperFn20(localValue93, helperFn11(resolvedValue99, resolvedValue100)), true);
}
function helperFn19(arg157, arg158) {
  const stringValue3 = String(arg158 ?? "");
  return [...arg157.querySelectorAll("tr[data-editor-row-index]")].find((arg159) => String(arg159.dataset.editorRowIndex || "") === stringValue3) || null;
}
function helperFn20(arg160, arg161) {
  if (typeof arg160.replaceWith == "function") {
    arg160.replaceWith(arg161);
    return;
  }
  if (typeof arg160.parentNode?.replaceChild == "function") {
    arg160.parentNode.replaceChild(arg161, arg160);
    return;
  }
  const localValue94 = arg160.parentNode?.children;
  const localValue95 = Array.isArray(localValue94) ? localValue94.indexOf(arg160) : -1;
  if (localValue95 >= 0) {
    arg161.remove?.();
    arg161.parentNode = arg160.parentNode;
    localValue94.splice(localValue95, 1, arg161);
    arg160.parentNode = null;
  }
}
function helperFn21(arg162) {
  return String(arg162 || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}
