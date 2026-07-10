import { headers } from 'next/headers';
import { LegalDocumentLayout, LegalSection } from '@/components/legal-document-layout';
import { getWebLegalProfile } from '@/lib/legal';

export default async function TermsPage() {
  const requestHeaders = await headers();
  const profile = getWebLegalProfile(requestHeaders.get('host'));

  return (
    <LegalDocumentLayout profile={profile} title="用户协议" version={profile.termsVersion}>
      <LegalSection title="一、协议确认与适用范围">
        <p>欢迎使用{profile.platformName}。本协议是您与{profile.operatorLegalName}之间，就注册、登录、购买和使用本平台网站、ERP 系统、浏览器插件、接口、数据工具、培训支持及其他增值服务订立的协议。</p>
        <p>您勾选同意、注册、完成首次初始化、购买或继续使用服务，即表示您已阅读、理解并接受本协议。若您代表企业或其他组织使用服务，您确认已获得充分授权。不同意任何条款时，请停止注册或使用服务。</p>
      </LegalSection>

      <LegalSection title="二、服务内容">
        <p>本平台主要面向跨境电商经营者，提供商品数据采集、整理、筛选和分析，图片、标题、描述、类目、价格与库存管理，Ozon 等电商平台的商品和店铺数据处理，订单与库存辅助，表格导入导出、批量处理、模板转换、插件连接、自动化工具及经营数据看板等功能。</p>
        <p>具体功能、容量、使用期限和服务标准，以您实际开通的版本、套餐页面、订单记录、部署说明或双方书面约定为准。本协议当前适用于“{profile.deploymentLabel}”。</p>
      </LegalSection>

      <LegalSection title="三、账号注册、安全与使用">
        <p>您应提供真实、合法、有效的信息，并妥善保管账号、密码、短信验证码、API Token、Cookie、店铺授权密钥等凭证。因您主动泄露、保管不善或授权他人操作造成的损失，由您依法承担。</p>
        <p>未经书面许可，不得转让、出租、出借、售卖账号或服务权限。发现异常登录、凭证泄露或未经授权的操作时，应立即修改密码、撤销相关授权并联系平台。</p>
      </LegalSection>

      <LegalSection title="四、用户行为规范">
        <p>您应遵守适用法律法规、目标电商平台规则及本协议，不得利用本服务侵犯知识产权、商业秘密、隐私权、肖像权或其他合法权益；不得采集、上传、发布违法违规商品或信息；不得攻击系统、绕过权限、恶意调用接口，或非法获取、使用、买卖他人账号、店铺、订单和客户数据。</p>
        <p>如存在违法违规、危害系统安全或损害平台及第三方权益的行为，我们有权根据风险采取限制功能、暂停服务、封禁账号、删除违法信息、终止合作等措施，并保留依法追究责任的权利。</p>
      </LegalSection>

      <LegalSection title="五、第三方平台授权与数据准确性">
        <p>服务可能按您的指令连接 Ozon、1688、物流、支付、对象存储、短信、AI 等第三方平台。您应确保拥有相关店铺、账号、接口和数据的合法使用权；第三方服务的可用性、规则和信息处理行为由相应第三方负责。</p>
        <p>商品价格、库存、销量、类目、佣金、汇率、运费和利润等数据可能因接口延迟、规则调整或数据源变化而存在误差。自动化计算、AI 生成内容、翻译、类目匹配和经营建议仅作辅助参考，您应在发布、采购或作出经营决策前自行核验。</p>
      </LegalSection>

      <LegalSection title="六、费用、服务变更与终止">
        <p>您应按照页面、报价单、订单或合同约定支付费用。因用户自身不使用、操作错误、账号违规、目标平台封禁等非平台原因导致服务无法使用的，已支付费用原则上不予退还；法律另有规定或双方另有书面约定的除外。</p>
        <p>因维护升级、安全风险、欠费、第三方接口或政策变化、不可抗力等原因，我们可能在合理范围内调整、暂停或终止部分服务，并尽可能通过公告、站内通知、短信或邮件进行提示。</p>
      </LegalSection>

      <LegalSection title="七、知识产权与 AI 生成内容">
        <p>平台软件、插件、页面、代码、接口、流程、算法、文档、商标、Logo 和教程等知识产权归本平台或相关权利人所有。未经书面许可，不得复制、传播、出租、售卖、反编译、破解或用于开发竞争性产品。</p>
        <p>AI 生成的标题、描述、图片、翻译、类目建议或分析可能不准确、不完整或不符合目标平台规则。您应在对外发布前审核其真实性、合法性、知识产权及合规性。</p>
      </LegalSection>

      <LegalSection title="八、免责声明与违约责任">
        <p>在法律允许范围内，平台不对用户操作失误、第三方平台政策或接口限制、网络和基础设施故障、不可抗力、商品侵权或违规、经营亏损，以及用户泄露账号或授权信息等非平台原因造成的损失承担责任。</p>
        <p>一方违反本协议并给对方或第三方造成损失的，应依法承担责任。除法律另有强制规定外，平台就相关服务承担的累计赔偿责任，以您就导致该责任的相关服务已实际支付的费用总额为上限。</p>
      </LegalSection>

      <LegalSection title="九、协议变更、法律适用与联系">
        <p>我们可根据法律、业务和产品变化更新本协议。重大变化将通过网站公告、系统弹窗、站内通知、短信、邮件或其他合理方式提示；更新后的协议在标明的日期生效。</p>
        <p>本协议适用中华人民共和国法律。争议应先友好协商；协商不成的，任一方可向{profile.operatorLegalName}住所地有管辖权的人民法院提起诉讼。</p>
        <p>运营主体：{profile.operatorLegalName}<br />平台名称：{profile.platformName}<br />官方网站：{profile.websiteUrl}<br />联系方式：{profile.contactText}</p>
      </LegalSection>
    </LegalDocumentLayout>
  );
}
