import { normalizeFieldLookupKey } from "../field-key-utils.js";
const arrayValue = ["货号", "商家编码", "照片货号"];
const arrayValue2 = ["型号名称", "modelname", "合并为一张商品", "合并至一张"];
const arrayValue3 = ["主图链接", "mainimage", "附加图片链接", "extraimages", "json富内容", "richcontent", "颜色样本", "colorsample", "型号名称", "modelname", "合并为一张商品", "合并至一张"];
const arrayValue4 = ["主图链接", "mainimage"];
const arrayValue5 = ["附加图片链接", "extraimages"];
const arrayValue6 = ["360全景图像链接", "全景图像链接", "照片货号"];
const arrayValue7 = ["颜色样本", "colorsample"];
const arrayValue8 = ["json富内容", "richcontent"];
const arrayValue9 = ["json大小图表", "sizechart", "sizeguide"];
const arrayValue10 = ["品牌", "brand", "бренд"];
const arrayValue11 = ["制造国", "原产国", "产地", "生产国", "country", "origincountry", "countryoforigin", "madein"];
const arrayValue12 = ["留评获分", "reviewreward"];
const arrayValue13 = ["包装", "装运", "外箱", "package"];
const arrayValue14 = ["商品", "产品", "单件", "product"];
const arrayValue15 = ["重", "weight"];
const arrayValue16 = ["长", "length"];
const arrayValue17 = ["宽", "width"];
const arrayValue18 = ["高", "height"];
const arrayValue19 = ["中国", "中国制造", "中国（中国）", "中华人民共和国", "China", "Made in China", "Китай"];
const arrayValue20 = ["中国", "china", "китай"];
function helperFn2(arg4, arg5 = {}) {
  return [String(arg4 || ""), String(arg5?.header || ""), String(arg5?.editorLabel || "")].map((arg6) => arg6.trim()).filter(Boolean).join(" ");
}
function helperFn3(arg7, arg8 = {}) {
  return normalizeFieldLookupKey(helperFn2(arg7, arg8));
}
function helperFn4(arg9, arg10) {
  return arg10.some((arg11) => arg9.includes(arg11));
}
function helperFn5(arg12, ...resolvedValue2) {
  const trimResult5 = String(arg12?._systemFieldType || "").trim();
  return Boolean(trimResult5) && resolvedValue2.includes(trimResult5);
}
function helperFn6(arg13) {
  if (helperFn4(arg13, arrayValue16)) {
    return "length";
  } else if (helperFn4(arg13, arrayValue17)) {
    return "width";
  } else if (helperFn4(arg13, arrayValue18)) {
    return "height";
  } else {
    return "";
  }
}
function helperFn7(arg14) {
  const toLowerCaseResult6 = String(arg14 || "").toLowerCase();
  return toLowerCaseResult6.includes("链接") || toLowerCaseResult6.includes("link") || toLowerCaseResult6.includes("url") || toLowerCaseResult6.includes("ссылк");
}
const arrayValue21 = ["型号制造商的文章", "制造商的文章", "manufacturerarticle"];
export function isSkuLikeField(arg15, arg16 = {}) {
  const toLowerCaseResult7 = String(arg16?.semanticType || "").trim().toLowerCase();
  return toLowerCaseResult7 === "merchant_sku" || toLowerCaseResult7 === "seller_sku" || helperFn4(helperFn3(arg15, arg16), arrayValue);
}
export function isModelNameLikeField(arg17, arg18 = {}) {
  return helperFn4(helperFn3(arg17, arg18), arrayValue2);
}
export function isManufacturerArticleField(arg19, arg20 = {}) {
  const helperValue3 = helperFn3(arg19, arg20);
  return helperFn4(helperValue3, arrayValue21) || helperValue3.includes(normalizeFieldLookupKey("型号制造商的文章")) || helperValue3.includes(normalizeFieldLookupKey("制造商的文章"));
}
export function isAutoManagedMergeField(arg21, arg22 = {}) {
  return !!arg22?.systemManaged || !!arg22?.isAutoManaged || !!helperFn5(arg22, "review_reward") || helperFn4(helperFn3(arg21, arg22), arrayValue3);
}
export function isRowNumberField(arg23, arg24 = {}) {
  const toLowerCaseResult8 = String(arg23 || "").replace(/[\[\]\s]/g, "").toLowerCase();
  const helperValue32 = helperFn3(arg23, arg24);
  return toLowerCaseResult8 === "№" || helperValue32 === "№" || toLowerCaseResult8 === "no" || toLowerCaseResult8 === "number";
}
export function getVideoFieldSystemType(arg25, arg26 = {}) {
  const trimResult9 = String(arg26?._systemFieldType || "").trim();
  if (trimResult9.startsWith("video_")) {
    return trimResult9;
  }
  const helperValue33 = helperFn3(arg25, arg26);
  const localValue10 = helperFn2(arg25, arg26) + " " + helperValue33;
  if (function (arg27) {
    const toLowerCaseResult11 = String(arg27 || "").toLowerCase();
    return toLowerCaseResult11.includes("视频") || toLowerCaseResult11.includes("video") || toLowerCaseResult11.includes("видео") || toLowerCaseResult11.includes("видеообложк") || toLowerCaseResult11.includes("封面") && toLowerCaseResult11.includes("视频") || toLowerCaseResult11.includes("cover") && toLowerCaseResult11.includes("video") || toLowerCaseResult11.includes("preview") && toLowerCaseResult11.includes("video") || toLowerCaseResult11.includes("poster") && toLowerCaseResult11.includes("video") || toLowerCaseResult11.includes("обложк") && toLowerCaseResult11.includes("видео");
  }(localValue10)) {
    if (function (arg28) {
      const toLowerCaseResult12 = String(arg28 || "").toLowerCase();
      return toLowerCaseResult12.includes("封面") || toLowerCaseResult12.includes("背景") || toLowerCaseResult12.includes("cover") || toLowerCaseResult12.includes("poster") || toLowerCaseResult12.includes("preview") || toLowerCaseResult12.includes("обложк");
    }(localValue10) && helperFn7(localValue10)) {
      return "video_cover_url";
    } else if (function (arg29) {
      const toLowerCaseResult13 = String(arg29 || "").toLowerCase();
      return toLowerCaseResult13.includes("商品") || toLowerCaseResult13.includes("产品") || toLowerCaseResult13.includes("product") || toLowerCaseResult13.includes("item") || toLowerCaseResult13.includes("товар");
    }(localValue10)) {
      return "video_product";
    } else if (function (arg30) {
      const toLowerCaseResult14 = String(arg30 || "").toLowerCase();
      return toLowerCaseResult14.includes("标题") || toLowerCaseResult14.includes("名称") || toLowerCaseResult14.includes("title") || toLowerCaseResult14.includes("name") || toLowerCaseResult14.includes("назван");
    }(localValue10)) {
      return "video_title";
    } else {
      helperFn7(localValue10);
      return "video_url";
    }
  } else {
    return "";
  }
}
export function isMainImageField(arg31, arg32 = {}) {
  return helperFn4(helperFn3(arg31, arg32), arrayValue4);
}
export function isExtraImagesField(arg33, arg34 = {}) {
  return helperFn4(helperFn3(arg33, arg34), arrayValue5);
}
export function isColorSampleField(arg35, arg36 = {}) {
  return helperFn4(helperFn3(arg35, arg36), arrayValue7);
}
export function isRichContentField(arg37, arg38 = {}) {
  return helperFn4(helperFn3(arg37, arg38), arrayValue8);
}
export function isAuxiliaryImageField(arg39, arg40 = {}) {
  return helperFn4(helperFn3(arg39, arg40), arrayValue6);
}
export function isImageRelatedField(arg41, arg42 = {}) {
  return isMainImageField(arg41, arg42) || isExtraImagesField(arg41, arg42) || isColorSampleField(arg41, arg42) || isRichContentField(arg41, arg42) || isAuxiliaryImageField(arg41, arg42);
}
export function isSizeChartField(arg43, arg44 = {}) {
  return helperFn4(helperFn3(arg43, arg44), arrayValue9);
}
export function isReviewRewardField(arg45, arg46 = {}) {
  return !!helperFn5(arg46, "review_reward") || helperFn4(helperFn3(arg45, arg46), arrayValue12);
}
export function isCountryField(arg47, arg48 = {}) {
  return helperFn4(helperFn3(arg47, arg48), arrayValue11);
}
export function findCountryOptionMatch(arg49) {
  const filterResult15 = (arg49 || []).map((arg50) => String(arg50 || "").trim()).filter(Boolean);
  for (const localValue16 of arrayValue19) {
    const findResult17 = filterResult15.find((arg51) => arg51 === localValue16);
    if (findResult17) {
      return findResult17;
    }
  }
  for (const localValue18 of arrayValue20) {
    const findResult19 = filterResult15.find((arg52) => arg52.toLowerCase().includes(localValue18.toLowerCase()));
    if (findResult19) {
      return findResult19;
    }
  }
  return "";
}
export function resolveCountryFieldValue(arg53 = {}, arg54 = "") {
  const selectedValue20 = Array.isArray(arg53?.options) ? arg53.options : [];
  const localValue21 = Number(arg53?._dictionaryId || 0) > 0;
  if (selectedValue20.length) {
    return findCountryOptionMatch(selectedValue20) || undefined;
  }
  if (!localValue21) {
    return arg54;
  }
}
export function isBrandField(arg55, arg56 = {}) {
  return helperFn4(helperFn3(arg55, arg56), arrayValue10);
}
export function isPackageWeightField(arg57, arg58 = {}) {
  if (helperFn5(arg58, "weight_g")) {
    return true;
  }
  const helperValue34 = helperFn3(arg57, arg58);
  return !!helperValue34.includes("毛重") || helperFn4(helperValue34, arrayValue13) && helperFn4(helperValue34, arrayValue15);
}
export function isPackageDimensionField(arg59, arg60 = {}, arg61 = "") {
  const trimResult22 = String(arg61 || "").trim();
  if (trimResult22) {
    if (trimResult22 === "width" && helperFn5(arg60, "width_mm")) {
      return true;
    }
    if (trimResult22 === "height" && helperFn5(arg60, "height_mm")) {
      return true;
    }
    if (trimResult22 === "length" && helperFn5(arg60, "depth_mm")) {
      return true;
    }
  } else if (helperFn5(arg60, "width_mm", "height_mm", "depth_mm")) {
    return true;
  }
  const helperValue35 = helperFn3(arg59, arg60);
  if (!helperFn4(helperValue35, arrayValue13)) {
    return false;
  }
  const helperValue6 = helperFn6(helperValue35);
  return !!helperValue6 && (!trimResult22 || helperValue6 === trimResult22);
}
export function isPackageLengthField(arg62, arg63 = {}) {
  return isPackageDimensionField(arg62, arg63, "length");
}
export function isPackageWidthField(arg64, arg65 = {}) {
  return isPackageDimensionField(arg64, arg65, "width");
}
export function isPackageHeightField(arg66, arg67 = {}) {
  return isPackageDimensionField(arg66, arg67, "height");
}
export function isProductWeightField(arg68, arg69 = {}) {
  const helperValue36 = helperFn3(arg68, arg69);
  return helperFn4(helperValue36, arrayValue14) && helperFn4(helperValue36, arrayValue15) && !helperFn4(helperValue36, arrayValue13);
}
export function isProductDimensionField(arg70, arg71 = {}, arg72 = "") {
  const trimResult23 = String(arg72 || "").trim();
  const helperValue37 = helperFn3(arg70, arg71);
  if (!helperFn4(helperValue37, arrayValue14) || helperFn4(helperValue37, arrayValue13)) {
    return false;
  }
  const helperValue62 = helperFn6(helperValue37);
  return !!helperValue62 && (!trimResult23 || helperValue62 === trimResult23);
}
export function isProductLengthField(arg73, arg74 = {}) {
  return isProductDimensionField(arg73, arg74, "length");
}
export function isProductWidthField(arg75, arg76 = {}) {
  return isProductDimensionField(arg75, arg76, "width");
}
export function isProductHeightField(arg77, arg78 = {}) {
  return isProductDimensionField(arg77, arg78, "height");
}
