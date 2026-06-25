#!/usr/bin/env python
# PDF text extraction script
# @param pdf_path 字符串 必填 PDF文件路径
# @param output 字符串 可选 输出文本文件路径（不填则输出到stdout）
# @param max_pages 整数 可选 最大提取页数（默认全部）

import sys
import argparse

def main():
    parser = argparse.ArgumentParser(description='Extract text from PDF')
    parser.add_argument('--pdf_path', required=True, help='PDF file path')
    parser.add_argument('--output', default='', help='Output text file path')
    parser.add_argument('--max_pages', type=int, default=0, help='Max pages (0=all)')
    args = parser.parse_args()

    try:
        import pdfplumber
    except ImportError:
        print("Error: pdfplumber not installed. Run: pip install pdfplumber")
        sys.exit(1)

    try:
        with pdfplumber.open(args.pdf_path) as pdf:
            total = len(pdf.pages)
            pages = pdf.pages[:args.max_pages] if args.max_pages > 0 else pdf.pages
            text_parts = []
            for i, page in enumerate(pages):
                text = page.extract_text() or ""
                text_parts.append(f"--- Page {i+1}/{total} ---\n{text}")
            result = "\n\n".join(text_parts)

            if args.output:
                with open(args.output, "w", encoding="utf-8") as f:
                    f.write(result)
                print(f"Success: Extracted {len(pages)} pages to {args.output}")
            else:
                print(result)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
