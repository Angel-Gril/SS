export type LegalProfileId = 'local' | 'cloud-cn' | 'cloud-global' | 'self-hosted';

export interface LegalProfile {
  id: LegalProfileId;
  platformName: string;
  operatorDisplayName: string;
  operatorLegalName: string;
  websiteUrl: string;
  contactText: string;
  effectiveDate: string;
  termsVersion: string;
  privacyVersion: string;
  deploymentLabel: string;
  dataHostingDescription: string;
  crossBorderDescription: string;
}

const COMMON_PROFILE = {
  platformName: '松鼠跨境 ERP',
  operatorDisplayName: '厦门常青藤上云',
  operatorLegalName: '常青藤上云（厦门）网络科技有限公司',
  contactText: '平台内在线客服',
  effectiveDate: '2026-07-10',
} as const;

const LEGAL_PROFILES: Record<LegalProfileId, LegalProfile> = {
  local: {
    ...COMMON_PROFILE,
    id: 'local',
    websiteUrl: 'http://localhost:3000',
    termsVersion: '2026-07-10-local',
    privacyVersion: '2026-07-10-local',
    deploymentLabel: '本地部署版',
    dataHostingDescription: '业务数据主要保存在用户自行管理的本地设备、数据库或局域网环境中。',
    crossBorderDescription: '只有在用户主动连接 Ozon、AI、物流等第三方服务时，必要数据才会按照用户指令传输给相应服务商。',
  },
  'cloud-cn': {
    ...COMMON_PROFILE,
    id: 'cloud-cn',
    websiteUrl: 'https://ss-erp.cn',
    termsVersion: '2026-07-10-cn',
    privacyVersion: '2026-07-10-cn',
    deploymentLabel: '中国大陆云端版',
    dataHostingDescription: '账号和业务数据主要保存在中国大陆地区依法运营的云基础设施中。',
    crossBorderDescription: '用户主动连接 Ozon 等境外平台时，完成该功能所必需的商品、店铺或订单数据可能根据用户指令传输至境外接收方。',
  },
  'cloud-global': {
    ...COMMON_PROFILE,
    id: 'cloud-global',
    websiteUrl: 'https://ss-erp.com',
    termsVersion: '2026-07-10-global',
    privacyVersion: '2026-07-10-global',
    deploymentLabel: '国际云端版',
    dataHostingDescription: '账号和业务数据可能保存在为跨境业务提供服务的境内外云基础设施中，具体以部署区域和页面说明为准。',
    crossBorderDescription: '为连接 Ozon、对象存储、AI、物流等跨境服务，必要数据可能在用户授权和实现功能所需范围内跨境传输。',
  },
  'self-hosted': {
    ...COMMON_PROFILE,
    id: 'self-hosted',
    websiteUrl: '由部署方配置',
    termsVersion: '2026-07-10-self-hosted',
    privacyVersion: '2026-07-10-self-hosted',
    deploymentLabel: '独立部署版',
    dataHostingDescription: '数据由购买或管理独立部署环境的主体在其选择的服务器、数据库和存储设施中处理。',
    crossBorderDescription: '是否发生跨境传输取决于部署方启用的第三方平台和基础设施，部署方应另行向最终用户说明。',
  },
};

export function getLegalProfile(profile: string | null | undefined): LegalProfile {
  const normalized = String(profile || '').trim().toLowerCase() as LegalProfileId;
  return LEGAL_PROFILES[normalized] || LEGAL_PROFILES.local;
}

export function listLegalProfiles(): LegalProfile[] {
  return Object.values(LEGAL_PROFILES);
}
