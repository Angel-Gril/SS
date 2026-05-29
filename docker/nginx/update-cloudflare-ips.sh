#!/bin/bash
# 自动更新 Cloudflare IP 列表到 Nginx 配置
# 建议加入 cron 每周执行一次：0 4 * * 1 /opt/ss-erp/docker/nginx/update-cloudflare-ips.sh

set -euo pipefail

CONF_FILE="/etc/nginx/conf.d/cloudflare-realip.conf"
TEMP_FILE=$(mktemp)

echo "# Auto-generated $(date '+%F %T') — do not edit manually" > "$TEMP_FILE"
echo "" >> "$TEMP_FILE"

echo "# Cloudflare IPv4" >> "$TEMP_FILE"
curl -s https://www.cloudflare.com/ips-v4 | while read -r ip; do
  [ -n "$ip" ] && echo "set_real_ip_from $ip;" >> "$TEMP_FILE"
done

echo "" >> "$TEMP_FILE"
echo "# Cloudflare IPv6" >> "$TEMP_FILE"
curl -s https://www.cloudflare.com/ips-v6 | while read -r ip; do
  [ -n "$ip" ] && echo "set_real_ip_from $ip;" >> "$TEMP_FILE"
done

echo "" >> "$TEMP_FILE"
echo "real_ip_header CF-Connecting-IP;" >> "$TEMP_FILE"

mv "$TEMP_FILE" "$CONF_FILE"
nginx -t && systemctl reload nginx
echo "[cloudflare-ips] updated $(date '+%F %T')"
