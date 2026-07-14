(() => {
  'use strict';

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const dropContent = document.getElementById('dropContent');
  const fileLoaded = document.getElementById('fileLoaded');
  const fileIconSvg = document.getElementById('fileIconSvg');
  const fileName = document.getElementById('fileName');
  const fileSize = document.getElementById('fileSize');
  const seam = document.getElementById('seam');
  const stepsList = document.getElementById('steps');
  const paneOut = document.getElementById('paneOut');
  const editorEmpty = document.getElementById('editorEmpty');
  const editorBody = document.getElementById('editorBody');
  const gutter = document.getElementById('gutter');
  const codeOutput = document.getElementById('codeOutput');
  const editorActions = document.getElementById('editorActions');
  const copyBtn = document.getElementById('copyBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const resetBtn = document.getElementById('resetBtn');
  const statCount = document.getElementById('statCount');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const toastStack = document.getElementById('toastStack');

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const turndownService = window.TurndownService ? new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-'
  }) : null;

  let currentBaseName = 'converted';

  // ---------- toasts ----------
  function showToast(message, type = 'info', duration = 4200) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    toastStack.appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 200);
    }, duration);
  }

  // ---------- step progress ----------
  function setStep(stepKey) {
    const order = ['waiting', 'reading', 'parsing', 'writing', 'done'];
    const targetIdx = order.indexOf(stepKey);
    stepsList.querySelectorAll('.step').forEach(li => {
      const idx = order.indexOf(li.dataset.step);
      li.classList.remove('active', 'complete');
      if (idx < targetIdx) li.classList.add('complete');
      else if (idx === targetIdx) li.classList.add('active');
    });
    seam.classList.toggle('idle', stepKey === 'waiting');
    seam.classList.toggle('active', stepKey !== 'waiting' && stepKey !== 'done');
    seam.classList.toggle('done', stepKey === 'done');
  }

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ---------- file icons ----------
  const ICONS = {
    pdf: 'M6 2h9l5 5v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z',
    docx: 'M6 2h9l5 5v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z',
    txt: 'M6 2h9l5 5v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z'
  };
  function setFileIcon() {
    // Same base document glyph for all supported types today — kept simple and legible at 18px.
    fileIconSvg.querySelector('path').setAttribute('d', ICONS.pdf);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // ---------- UI wiring ----------
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });
  ['dragenter', 'dragover'].forEach(evt =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); })
  );
  ['dragleave', 'drop'].forEach(evt =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); })
  );
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  resetBtn.addEventListener('click', resetUI);

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(codeOutput.dataset.raw || codeOutput.textContent);
      copyBtn.textContent = 'Copied ✓';
      showToast('Markdown copied to clipboard.', 'success', 2200);
      setTimeout(() => (copyBtn.textContent = 'Copy Markdown'), 1600);
    } catch {
      showToast('Could not access clipboard — select the text manually.', 'error');
    }
  });

  downloadBtn.addEventListener('click', () => {
    const blob = new Blob([codeOutput.dataset.raw || codeOutput.textContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentBaseName}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${currentBaseName}.md`, 'success', 2200);
  });

  fullscreenBtn.addEventListener('click', () => {
    paneOut.classList.toggle('fullscreen');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && paneOut.classList.contains('fullscreen')) {
      paneOut.classList.remove('fullscreen');
    }
  });

  function resetUI() {
    fileInput.value = '';
    dropContent.hidden = false;
    fileLoaded.hidden = true;
    editorEmpty.hidden = false;
    editorBody.hidden = true;
    editorActions.hidden = true;
    statCount.hidden = true;
    fullscreenBtn.hidden = true;
    paneOut.classList.remove('fullscreen');
    setStep('waiting');
    codeOutput.textContent = '';
    delete codeOutput.dataset.raw;
    gutter.innerHTML = '';
  }

  // ---------- main handler ----------
  async function handleFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const supported = ['pdf', 'docx', 'txt'];
    if (!supported.includes(ext)) {
      showToast(`.${ext} isn't supported yet — try a PDF, DOCX, or TXT file.`, 'error');
      return;
    }

    currentBaseName = file.name.replace(/\.[^.]+$/, '');
    dropContent.hidden = true;
    fileLoaded.hidden = false;
    setFileIcon();
    fileName.textContent = file.name;
    fileSize.textContent = formatSize(file.size);

    try {
      setStep('reading');
      await wait(220);
      setStep('parsing');

      let markdown = '';
      if (ext === 'docx') {
        markdown = await convertDocx(file);
      } else if (ext === 'pdf') {
        markdown = await convertPdf(file);
      } else if (ext === 'txt') {
        markdown = await convertTxt(file);
      }

      setStep('writing');
      await wait(180);
      showResult(markdown);
    } catch (err) {
      console.error(err);
      setStep('waiting');
      showToast('Something went wrong reading that file. Try a different one, or check it isn\u2019t password-protected.', 'error', 5000);
    }
  }

  function escapeHtml(str) {
    return str.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  }

  function highlightMarkdown(text) {
    return text.split('\n').map(line => {
      let escaped = escapeHtml(line);

      const headingMatch = escaped.match(/^(#{1,6}\s.*)$/);
      if (headingMatch) return `<span class="md-heading">${headingMatch[1]}</span>`;

      if (/^---+$/.test(escaped.trim())) return `<span class="md-rule">${escaped}</span>`;

      const bulletMatch = escaped.match(/^(\s*)([-*])(\s.*)$/);
      if (bulletMatch) {
        escaped = `${bulletMatch[1]}<span class="md-bullet">${bulletMatch[2]}</span>${bulletMatch[3]}`;
      }

      escaped = escaped
        .replace(/`([^`]+)`/g, '<span class="md-code-inline">`$1`</span>')
        .replace(/\*\*([^*]+)\*\*/g, '<span class="md-bold">**$1**</span>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1](<span class="md-link">$2</span>)');

      return escaped;
    }).join('\n');
  }

  function showResult(markdown) {
    const finalText = markdown.trim() + '\n';
    codeOutput.dataset.raw = finalText;
    codeOutput.innerHTML = highlightMarkdown(finalText);
    const lineCount = finalText.split('\n').length;
    gutter.innerHTML = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');

    const words = finalText.trim().split(/\s+/).filter(Boolean).length;
    const chars = finalText.length;
    statCount.textContent = `${words.toLocaleString()} words · ${chars.toLocaleString()} chars`;
    statCount.hidden = false;
    fullscreenBtn.hidden = false;

    editorEmpty.hidden = true;
    editorBody.hidden = false;
    editorActions.hidden = false;
    setStep('done');
    showToast('Converted successfully.', 'success', 2600);
  }

  // ---------- DOCX ----------
  async function convertDocx(file) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const html = result.value;
    if (!turndownService) throw new Error('turndown not loaded');
    return turndownService.turndown(html);
  }

  // ---------- TXT ----------
  async function convertTxt(file) {
    const text = await file.text();
    return text
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ---------- PDF ----------
  async function convertPdf(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageBlocks = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const items = content.items.filter(i => i.str.trim().length > 0);
      if (items.length === 0) continue;

      // group items into lines by rounded y position
      const lines = [];
      let currentLine = null;
      const Y_TOLERANCE = 3;

      items.forEach(item => {
        const y = item.transform[5];
        const size = Math.hypot(item.transform[2], item.transform[3]) || item.height || 10;
        if (currentLine && Math.abs(currentLine.y - y) <= Y_TOLERANCE) {
          currentLine.items.push(item);
        } else {
          currentLine = { y, items: [item], size };
          lines.push(currentLine);
        }
      });

      // sort lines top-to-bottom (pdf.js y grows upward)
      lines.sort((a, b) => b.y - a.y);

      // build line text + track font size + vertical gaps
      const built = lines.map((line, idx) => {
        line.items.sort((a, b) => a.transform[4] - b.transform[4]);
        const text = line.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
        const sizes = line.items.map(i => Math.hypot(i.transform[2], i.transform[3]) || 10);
        const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
        const gapAbove = idx > 0 ? lines[idx - 1].y - line.y : 0;
        return { text, avgSize, gapAbove };
      }).filter(l => l.text.length > 0);

      if (built.length === 0) continue;

      const sizes = built.map(l => l.avgSize).sort((a, b) => a - b);
      const medianSize = sizes[Math.floor(sizes.length / 2)] || 10;
      const gaps = built.map(l => l.gapAbove).filter(g => g > 0).sort((a, b) => a - b);
      const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 14;

      const outLines = [];
      built.forEach((line, idx) => {
        const ratio = line.avgSize / medianSize;
        const isNewParagraph = idx > 0 && line.gapAbove > medianGap * 1.6;

        let text = line.text;
        if (ratio >= 1.6) {
          text = `# ${text}`;
        } else if (ratio >= 1.3) {
          text = `## ${text}`;
        } else if (ratio >= 1.15) {
          text = `### ${text}`;
        } else if (/^[•▪◦●]\s?/.test(text)) {
          text = text.replace(/^[•▪◦●]\s?/, '- ');
        }

        if (isNewParagraph && outLines.length > 0) outLines.push('');
        outLines.push(text);
      });

      pageBlocks.push(outLines.join('\n'));
    }

    return pageBlocks.join('\n\n---\n\n');
  }

  resetUI();

  // ---------- scroll reveal ----------
  const revealEls = document.querySelectorAll('[data-reveal]');
  if (revealEls.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('revealed'));
  }
})();
