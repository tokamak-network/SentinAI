# SentinAI Whitepaper (LaTeX Version)

## Overview

This directory contains the LaTeX source (`whitepaper.tex`) for the SentinAI whitepaper, designed for professional academic-style PDF output.

## Files

- `whitepaper.tex` - LaTeX source file (11pt, A4 paper, article class)
- `whitepaper.md` - Markdown version (web-friendly)

## Compiling to PDF

### Prerequisites

Install TeX Live (full distribution recommended):

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install texlive-full
```

**macOS (via Homebrew):**
```bash
brew install --cask mactex
```

**Windows:**
Download and install [MiKTeX](https://miktex.org/download) or [TeX Live](https://www.tug.org/texlive/windows.html).

### Compile Commands

```bash
cd docs

# Compile (run twice for TOC and references)
pdflatex whitepaper.tex
pdflatex whitepaper.tex

# Clean auxiliary files
rm -f whitepaper.aux whitepaper.log whitepaper.out whitepaper.toc
```

**Output**: `whitepaper.pdf`

### Alternative: Online LaTeX Editors

If you don't want to install TeX locally, use online editors:

- **Overleaf**: Upload `whitepaper.tex` to [Overleaf](https://www.overleaf.com/)
- **Papeeria**: [Papeeria Online LaTeX Editor](https://papeeria.com/)
- **LaTeX.Online**: [latex.online](https://latexonline.cc/)

## Document Structure

- **Title & Abstract**: Overview and key contributions
- **Problem Statement**: Operational challenges in L2 infrastructure
- **Design Principles**: Safety-first autonomy, policy-over-model, auditability
- **System Architecture**: 6 core subsystems (telemetry, anomaly detection, RCA, etc.)
- **Incident Lifecycle**: Detect → Plan → Approve → Verify → Rollback
- **Risk Framework**: Risk tiers, forbidden actions, approval boundaries
- **Evaluation Metrics**: MTTR, auto-resolution rate, false action rate
- **Case Studies**: 3 real-world scenarios with MTTR improvements
- **Security & Compliance**: Least privilege, traceability, audit controls
- **Roadmap**: Q1-Q2 2026 plans and future research directions
- **Limitations**: Known boundaries and planned improvements
- **Conclusion**: Key contributions and adoption path

## Customization

### Change Paper Size
```latex
% A4 (default)
\usepackage[a4paper,margin=1in]{geometry}

% US Letter
\usepackage[letterpaper,margin=1in]{geometry}
```

### Change Font Size
```latex
% 11pt (default)
\documentclass[11pt,a4paper]{article}

% 12pt
\documentclass[12pt,a4paper]{article}
```

### Two-Column Layout (IEEE Style)
```latex
\documentclass[conference]{IEEEtran}
```

### Add References
Create `references.bib` and add at the end of `whitepaper.tex`:
```latex
\bibliographystyle{IEEEtran}
\bibliography{references}
```

Then compile with:
```bash
pdflatex whitepaper.tex
bibtex whitepaper
pdflatex whitepaper.tex
pdflatex whitepaper.tex
```

## Publishing

### arXiv Submission
1. Compress source files:
   ```bash
   tar -czf whitepaper-arxiv.tar.gz whitepaper.tex
   ```
2. Upload to [arXiv.org](https://arxiv.org/)

### Conference Submission
- IEEE format: Change document class to `IEEEtran`
- ACM format: Use `acmart` document class
- Springer LNCS: Use `llncs` document class

## Maintenance

- **Markdown version** (`whitepaper.md`): Keep in sync for web docs
- **LaTeX version** (`whitepaper.tex`): Use for PDF distribution and academic submissions

## License

Same as main SentinAI project (see root LICENSE file).
