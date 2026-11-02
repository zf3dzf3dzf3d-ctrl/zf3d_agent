from PIL import Image
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\public\宣传片\z妹三视图\黑玫瑰_三视图_参考图.png'
out = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\public\宣传片\z妹三视图\黑玫瑰_单人正面_参考图.png'
im = Image.open(p)
w, h = im.size
im.crop((0, 0, w // 3, h)).save(out)
print('OK', w // 3, h, out)
