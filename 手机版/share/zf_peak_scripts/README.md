# 峰控预装定时脚本包
手机装好 Termux 后，把本目录两个 sh 复制到 /sdcard/zf_peak/，执行：
  pkg install cronie -y && sh /sdcard/zf_peak/cron_setup.sh
修改 morning_report.sh 里的 TOPIC（ntfy主题）和 CITY（城市）。
