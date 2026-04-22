"""Generate PNG icons for the Chrome extension using PIL.

Font: Source Han Sans / 思源黑体 (OFL-1.1 license, safe for open-source distribution).
"""
import os
from PIL import Image, ImageDraw, ImageFont

# Source Han Sans (思源黑体) — OFL-1.1 licensed
FONT_PATH = os.path.expanduser("~/Library/Fonts/SourceHanSans.ttc")

def create_icon(size, output_path):
    """Create a CCF rank icon at the specified size."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    padding = max(0, size // 16)
    radius = max(2, size // 6)
    
    # Background rounded rectangle
    draw.rounded_rectangle(
        [padding, padding, size - padding - 1, size - padding - 1],
        radius=radius,
        fill=(22, 33, 62, 255)
    )
    
    # Orange accent bar at top
    bar_h = max(2, size // 8)
    draw.rounded_rectangle(
        [padding, padding, size - padding - 1, padding + bar_h],
        radius=min(radius, bar_h),
        fill=(255, 107, 53, 255)
    )
    # Fill the bottom corners of the bar
    draw.rectangle(
        [padding, padding + bar_h // 2, size - padding - 1, padding + bar_h],
        fill=(255, 107, 53, 255)
    )
    
    if size >= 48:
        # Large icon: show "CCF" and "A"
        try:
            font_top = ImageFont.truetype(FONT_PATH, max(10, size // 5))
            font_bottom = ImageFont.truetype(FONT_PATH, max(14, size // 3))
        except OSError:
            font_top = ImageFont.load_default()
            font_bottom = font_top
        
        # "CCF" text
        bbox = draw.textbbox((0, 0), "CCF", font=font_top)
        tw = bbox[2] - bbox[0]
        draw.text(((size - tw) // 2, size // 4), "CCF", fill=(180, 190, 210, 255), font=font_top)
        
        # "A" in orange
        bbox = draw.textbbox((0, 0), "A", font=font_bottom)
        tw = bbox[2] - bbox[0]
        draw.text(((size - tw) // 2, size * 9 // 20), "A", fill=(255, 147, 30, 255), font=font_bottom)
    else:
        # Small icon (16px): just show "A" 
        try:
            font = ImageFont.truetype(FONT_PATH, max(9, size * 2 // 3))
        except OSError:
            font = ImageFont.load_default()
        bbox = draw.textbbox((0, 0), "A", font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        draw.text(((size - tw) // 2, (size - th) // 2 + 1), "A", fill=(255, 147, 30, 255), font=font)
    
    img.save(output_path, 'PNG')
    print(f"Created {output_path} ({size}x{size})")

ICON_DIR = "ccf-recommended-list-google-scholar-extension/icons"
create_icon(16, f"{ICON_DIR}/icon16.png")
create_icon(48, f"{ICON_DIR}/icon48.png")
create_icon(128, f"{ICON_DIR}/icon128.png")
print("All icons generated!")
