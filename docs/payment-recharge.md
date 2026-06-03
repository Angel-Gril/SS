# 充值与支付

SS ERP 支持两种充值通道：

- 自动充值：易支付兼容网关（彩虹易支付/同类接口）
- 人工充值：后台维护收款码，用户上传付款凭证，超管审核入账

## 易支付自动充值

后台入口：`/admin/payments`

配置支付网关：

- 网关地址：易支付站点根地址，例如 `https://pay.example.com`
- 商户 PID：易支付后台提供的商户 ID
- 商户 KEY：易支付后台提供的签名密钥，保存时会加密
- 渠道：`alipay,wxpay`
- 单笔限额、每日限额、手续费配置

支付回调的公网 API 地址优先读取 `PUBLIC_API_BASE_URL` 或 `NEXT_PUBLIC_API_BASE_URL`，云端默认回落到 `https://app.ss-erp.com`。这个地址必须能从易支付平台公网访问。

用户发起充值后，系统会生成易支付 `submit.php` 跳转链接。异步回调地址格式：

```txt
https://app.ss-erp.com/api/payments/notify/epay/{providerId}
```

回调处理规则：

- 必须通过 MD5 签名校验
- `trade_status` 必须为 `TRADE_SUCCESS`
- `out_trade_no` 必须匹配 ERP 充值订单
- 回调金额必须等于订单金额
- 已入账订单重复回调只返回 `success`，不会重复加余额
- 入账在数据库事务中完成：更新订单、增加余额、写交易流水
- 所有回调写入 `payment_notify_logs`

同步跳转 `return_url` 只用于页面展示，不作为入账依据。

## 人工充值

后台入口：`/admin/payments -> 人工收款码`

可维护多个收款码：

- 渠道：支付宝/微信
- 收款人
- 二维码图片 URL
- 单笔限额、每日限额
- 权重、启用状态

用户创建人工充值订单后，系统按渠道和权重选择一个可用收款码。用户付款后上传截图或填写备注，订单进入 `proof_submitted` 状态。超管审核通过后，系统事务入账。

## 状态说明

- `pending`：待支付/待提交凭证
- `proof_submitted`：人工充值待审核
- `paid`：已到账
- `rejected`：人工审核拒绝
- `cancelled`：用户取消
- `timeout`：超时关闭
- `failed`：支付失败

## Worker

`recharge-timeout` worker 每 5 分钟检查超时订单，将未入账的 `pending/proof_submitted` 订单标记为 `timeout`。
