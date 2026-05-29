#!/bin/bash
# 自动更新 Cloudflare IP 列表到 Nginx 配置
# 建议加入 cron 每周执行一次：0 4 * * 1 /opt/ss-erp/docker/nginx/update-cloudflare-ips.sh

set -euo pipefail

CONF_FILE="/etc/nginx/conf.d/cloudflare-realip.conf"
TEMP_FILE=$(mktemp)
CF_IPV4=$(mktemp)
CF_IPV6=$(mktemp)
trap 'rm -f "$TEMP_FILE" "$CF_IPV4" "$CF_IPV6"' EXIT

curl -fsS https://www.cloudflare.com/ips-v4 > "$CF_IPV4"
curl -fsS https://www.cloudflare.com/ips-v6 > "$CF_IPV6"

echo "# Auto-generated $(date '+%F %T') - do not edit manually" > "$TEMP_FILE"
echo "" >> "$TEMP_FILE"

echo "# Cloudflare IPv4" >> "$TEMP_FILE"
while read -r ip; do
  [ -n "$ip" ] && echo "set_real_ip_from $ip;" >> "$TEMP_FILE"
done < "$CF_IPV4"

echo "" >> "$TEMP_FILE"
echo "# Cloudflare IPv6" >> "$TEMP_FILE"
while read -r ip; do
  [ -n "$ip" ] && echo "set_real_ip_from $ip;" >> "$TEMP_FILE"
done < "$CF_IPV6"

echo "" >> "$TEMP_FILE"
echo "real_ip_header CF-Connecting-IP;" >> "$TEMP_FILE"
echo "" >> "$TEMP_FILE"
echo "# ss-erp.conf uses \$realip_remote_addr for Cloudflare source checks after real_ip_header rewrites \$remote_addr." >> "$TEMP_FILE"
echo "geo \$realip_remote_addr \$is_cloudflare {" >> "$TEMP_FILE"
echo "    default 0;" >> "$TEMP_FILE"
while read -r ip; do
  [ -n "$ip" ] && echo "    $ip 1;" >> "$TEMP_FILE"
done < "$CF_IPV4"
while read -r ip; do
  [ -n "$ip" ] && echo "    $ip 1;" >> "$TEMP_FILE"
done < "$CF_IPV6"
echo "    # 本地开发 / 运维 SSH 放行" >> "$TEMP_FILE"
echo "    127.0.0.1/32 1;" >> "$TEMP_FILE"
echo "    ::1/128 1;" >> "$TEMP_FILE"
echo "}" >> "$TEMP_FILE"

mv "$TEMP_FILE" "$CONF_FILE"
nginx -t && systemctl reload nginx
echo "[cloudflare-ips] updated $(date '+%F %T')"
