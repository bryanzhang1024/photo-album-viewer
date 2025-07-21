#!/usr/bin/env python3
"""
修复应用图标：将白色背景转为透明并创建圆角矩形效果
"""

from PIL import Image, ImageDraw
import numpy as np

def create_rounded_rectangle_mask(size, radius):
    """创建圆角矩形遮罩"""
    mask = Image.new('L', size, 0)
    draw = ImageDraw.Draw(mask)
    
    # 绘制圆角矩形
    draw.rounded_rectangle([(0, 0), size], radius=radius, fill=255)
    
    return mask

def fix_icon_transparency(input_path, output_path, radius_factor=0.2):
    """
    修复图标透明度问题
    
    Args:
        input_path: 输入图标路径
        output_path: 输出图标路径
        radius_factor: 圆角半径比例 (0-0.5)
    """
    # 打开原始图标
    img = Image.open(input_path)
    
    # 转换为RGBA模式
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    
    # 获取尺寸
    width, height = img.size
    
    # 计算圆角半径
    radius = int(min(width, height) * radius_factor)
    
    # 创建圆角矩形遮罩
    mask = create_rounded_rectangle_mask((width, height), radius)
    
    # 应用遮罩到alpha通道
    img.putalpha(mask)
    
    # 保存处理后的图标
    img.save(output_path, 'PNG')
    print(f"已修复图标：{output_path}")
    
    return img

def create_icns_from_png(png_path, icns_path, sizes=None):
    """从PNG创建ICNS图标集"""
    if sizes is None:
        sizes = [16, 32, 64, 128, 256, 512, 1024]
    
    try:
        # 注意：这需要安装pyobjc-framework-Quartz库
        import subprocess
        
        # 使用系统自带的sips命令创建ICNS
        cmd = [
            'sips', '-s', 'format', 'icns',
            png_path, '--out', icns_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            print(f"已创建ICNS图标：{icns_path}")
            return True
        else:
            print(f"创建ICNS失败：{result.stderr}")
            return False
            
    except Exception as e:
        print(f"创建ICNS时出错：{e}")
        return False

if __name__ == "__main__":
    # 修复PNG图标
    fix_icon_transparency('icon.png', 'icon_fixed.png')
    
    # 创建ICNS图标
    create_icns_from_png('icon_fixed.png', 'MyApp_fixed.icns')
    
    print("图标修复完成！")