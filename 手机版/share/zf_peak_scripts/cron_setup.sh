#!/bin/sh
# Termux 定时激活：先装 cronie（pkg install cronie termux-services），再注册晨报
sv-enable crond 2>/dev/null || crond
crontab -l 2>/dev/null | grep -v morning_report > /tmp/c
echo "0 7 * * * sh /sdcard/zf_peak/morning_report.sh" >> /tmp/c
crontab /tmp/c && echo "OK 晨报已注册 每天7:00"
