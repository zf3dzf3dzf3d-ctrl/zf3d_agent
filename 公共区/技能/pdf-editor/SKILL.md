---
name: pdf-editor
description: PDF processing and manipulation. Use when Codely CLI needs to work with PDF files to extract text, rotate pages, merge PDFs, or split documents.
---

# PDF Editor Skill

## Quick Start

Extract text from PDF using pdfplumber:

```python
import pdfplumber
with pdfplumber.open("file.pdf") as pdf:
    for page in pdf.pages:
        print(page.extract_text())
```

## Available Operations

- **Extract text**: Use `pdfplumber` to extract text from each page
- **Rotate pages**: Use `PyPDF2` to rotate specific pages
- **Merge PDFs**: Combine multiple PDF files into one
- **Split PDF**: Split a PDF into individual pages

## Workflow

1. Check if the PDF file exists
2. Determine what the user wants: extract, rotate, merge, or split
3. Use the appropriate Python library (pdfplumber for text, PyPDF2 for manipulation)
4. Save results to the requested output path

## Important Notes

- Large PDFs may take time to process
- Encrypted PDFs require a password
- Text extraction quality depends on the PDF structure
