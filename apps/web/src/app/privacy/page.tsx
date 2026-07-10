import { headers } from 'next/headers';
import { LegalDocumentLayout, LegalSection } from '@/components/legal-document-layout';
import { getWebLegalProfile } from '@/lib/legal';

export default async function PrivacyPage() {
  const requestHeaders = await headers();
  const profile = getWebLegalProfile(requestHeaders.get('host'));

  return (
    <LegalDocumentLayout profile={profile} title="隐私政策" version={profile.privacyVersion}>
      <LegalSection title="一、前言与适用范围">
        <p>{profile.operatorLegalName}（简称“我们”）重视个人信息和业务数据安全。本政策说明您使用{profile.platformName}的网站、ERP 系统、插件、接口、数据工具及相关服务时，我们如何处理和保护信息，以及您如何行使相关权利。</p>
        <p>请在使用前仔细阅读。本政策当前适用于“{profile.deploymentLabel}”；若某项功能需要另行取得授权或单独同意，我们会在相应场景中再次告知。</p>
      </LegalSection>

      <LegalSection title="二、我们收集的信息">
        <p>为提供账号和 ERP 功能，我们可能处理：手机号、邮箱、用户名、昵称、加密后的密码等账号信息；公司、店铺、订单、付款记录、套餐和到期时间等身份及交易信息；Ozon、1688 等平台的 API Key、Token、Cookie、店铺授权信息；SKU、商品 ID、图片、库存、订单和物流等业务数据；IP 地址、设备与浏览器信息、访问时间、操作日志和错误日志；以及客服沟通、工单和远程协助记录。</p>
        <p>我们仅在实现明确功能所必要的范围内处理信息。密码以不可逆方式加密保存；接口密钥、Token 等敏感凭证将根据实际功能采取加密、访问控制或脱敏措施。</p>
      </LegalSection>

      <LegalSection title="三、我们如何使用信息">
        <p>信息用于创建、验证和管理账号，开通或续费服务，连接您授权的第三方平台，采集、整理、分析和同步商品、店铺、订单与库存数据，执行批量处理和导入导出，生成标题、描述、图片、翻译、类目或价格建议，以及计算利润、佣金、运费等经营指标。</p>
        <p>必要信息也用于客服和故障排查、识别异常登录与恶意请求、保护账号和系统安全、改进产品体验，以及履行法律法规、监管和争议处理义务。我们不会将信息用于与上述目的无关的用途，除非另行告知并依法取得授权。</p>
      </LegalSection>

      <LegalSection title="四、Cookie 和类似技术">
        <p>我们可能使用 Cookie、本地存储、Session、缓存和必要的设备标识，以保持登录状态、记住配置、提升访问速度、执行安全验证和排查异常。您可以通过浏览器清除或限制 Cookie，但登录状态及部分功能可能因此无法正常使用。</p>
        <p>“保持登录”仅延长受保护的会话凭证有效期，不会由应用保存或回显您的明文密码。浏览器自带的密码管理功能由您和浏览器服务商自行控制。</p>
      </LegalSection>

      <LegalSection title="五、共享、委托处理、转让与公开披露">
        <p>我们不会向无关第三方出售个人信息或店铺数据。为实现您选择的功能，必要信息可能传输给 Ozon、1688、物流、支付、对象存储、短信、客服、AI 或日志安全服务商；我们会要求受托服务商在授权范围内处理并采取合理安全措施。</p>
        <p>除取得您的授权外，仅在法律法规要求、司法或行政机关依法提出要求、保护用户和第三方合法权益，或发生合并、分立、收购等业务变更且依法履行告知义务时，才会共享、转让或披露必要信息。</p>
      </LegalSection>

      <LegalSection title="六、第三方平台与外部服务">
        <p>服务可能包含第三方链接、接口、插件或跳转页面。第三方独立决定的信息处理行为适用其自身协议和隐私政策，请您在授权前阅读。您可随时在本平台或相应第三方平台撤销不再需要的授权。</p>
      </LegalSection>

      <LegalSection title="七、存储期限、部署位置与安全保护">
        <p>{profile.dataHostingDescription}</p>
        <p>我们在实现服务目的所需的最短期限内保存信息；法律法规另有期限要求，或处理争议、安全审计确有必要的，按照相应期限保存。期限届满后，我们将依法删除或匿名化处理。</p>
        <p>我们采取密码哈希、敏感凭证加密或脱敏、权限分级、访问日志、防火墙、异常请求防护、备份恢复、员工保密与安全事件响应等措施。互联网服务无法保证绝对安全；发生可能影响您权益的安全事件时，我们将依法采取补救和通知措施。</p>
      </LegalSection>

      <LegalSection title="八、您的权利与账号注销">
        <p>您可以登录账号查看或修改基础资料，管理和撤销第三方授权，删除已上传的商品、图片、表格或业务数据，并通过客服申请查询、更正、复制、删除个人信息、撤回同意或注销账号。我们将在核验身份后依法处理。</p>
        <p>注销后您将无法继续使用该账号，尚未使用完的权益可能依约失效；依法需要留存的交易、安全和审计记录将在期限届满后删除或匿名化。撤回同意不影响撤回前基于同意已经进行的信息处理。</p>
      </LegalSection>

      <LegalSection title="九、未成年人、敏感信息与跨境传输">
        <p>本服务主要面向企业、个体工商户和具备完全民事行为能力的跨境电商经营者。未成年人不得在未取得监护人同意的情况下注册、购买或使用服务。</p>
        <p>API Token、Cookie、店铺授权、付款凭证和身份证明材料可能属于敏感信息，请仅在确有必要且确认来源、授权合法时提交。我们会在适用法律要求的场景中取得单独同意。</p>
        <p>{profile.crossBorderDescription}</p>
      </LegalSection>

      <LegalSection title="十、政策更新与联系我们">
        <p>我们可根据法律法规、部署方式和功能变化更新本政策。重大变化将通过网站公告、系统弹窗、站内通知、短信、邮件或其他合理方式提示，并在标明日期生效。</p>
        <p>如对个人信息处理有疑问、投诉、建议或希望行使权利，请通过以下方式联系：<br />个人信息处理者：{profile.operatorLegalName}<br />官方网站：{profile.websiteUrl}<br />联系方式：{profile.contactText}<br />隐私政策版本：{profile.privacyVersion}</p>
      </LegalSection>
    </LegalDocumentLayout>
  );
}
