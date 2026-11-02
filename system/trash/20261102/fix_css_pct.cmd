@echo off
"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\python\python.exe" -X utf8 -c "import io;p=r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\public\css\app-jobs.css';s=io.open(p,encoding='utf-8').read();s2=s.replace('0%%,100%%','0%,100%%');io.open(p,'w',encoding='utf-8').write(s2);print('CHANGED' if s!=s2 else 'NOCHANGE')"
