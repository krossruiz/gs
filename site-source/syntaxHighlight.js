/**
 * Lightweight JS / vr-exec syntax highlighter for the Code tab.
 * No build step, no CDN — tokenizes on the fly and returns HTML spans.
 */

const KEYWORDS = new Set([
	'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
	'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends',
	'false', 'finally', 'for', 'from', 'function', 'get', 'if', 'implements',
	'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'of',
	'package', 'private', 'protected', 'public', 'return', 'set', 'static',
	'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined',
	'var', 'void', 'while', 'with', 'yield'
]);

function escapeHtml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function span(cls, text) {
	return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

/**
 * Highlight JavaScript / vr-exec source as HTML (escaped text + token spans).
 * @param {string} source
 * @returns {string}
 */
export function highlightJs(source) {
	const src = String(source ?? '');
	if (!src) return '';

	let i = 0;
	const n = src.length;
	let out = '';

	while (i < n) {
		const ch = src[i];
		const next = src[i + 1];

		// Line comment
		if (ch === '/' && next === '/') {
			let j = i + 2;
			while (j < n && src[j] !== '\n') j++;
			out += span('tok-comment', src.slice(i, j));
			i = j;
			continue;
		}

		// Block comment
		if (ch === '/' && next === '*') {
			let j = i + 2;
			while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
			j = Math.min(n, j + 2);
			out += span('tok-comment', src.slice(i, j));
			i = j;
			continue;
		}

		// String / template
		if (ch === '"' || ch === "'" || ch === '`') {
			const quote = ch;
			let j = i + 1;
			while (j < n) {
				if (src[j] === '\\') { j += 2; continue; }
				if (src[j] === quote) { j++; break; }
				j++;
			}
			out += span('tok-string', src.slice(i, j));
			i = j;
			continue;
		}

		// Number
		if ((ch >= '0' && ch <= '9') || (ch === '.' && next >= '0' && next <= '9')) {
			let j = i + 1;
			while (j < n && /[0-9a-fA-FxX._n]/.test(src[j])) j++;
			out += span('tok-number', src.slice(i, j));
			i = j;
			continue;
		}

		// Identifier / keyword
		if (/[A-Za-z_$]/.test(ch)) {
			let j = i + 1;
			while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
			const word = src.slice(i, j);
			let k = j;
			while (k < n && (src[k] === ' ' || src[k] === '\t')) k++;
			if (KEYWORDS.has(word)) {
				out += span('tok-keyword', word);
			} else if (src[k] === '(') {
				out += span('tok-function', word);
			} else {
				out += escapeHtml(word);
			}
			i = j;
			continue;
		}

		// Operators / punctuation
		if (/[{}()\[\];,.<>+\-*/%=!&|^~?:]/.test(ch)) {
			let j = i + 1;
			while (j < n && /[{}()\[\];,.<>+\-*/%=!&|^~?:]/.test(src[j])) j++;
			out += span('tok-punct', src.slice(i, j));
			i = j;
			continue;
		}

		out += escapeHtml(ch);
		i++;
	}

	return out;
}

/**
 * Keep a <pre><code> highlight layer in sync with a transparent textarea.
 * @param {HTMLTextAreaElement} textarea
 * @param {HTMLElement} codeEl
 * @param {{pre?: HTMLElement}} [opts]
 * @returns {{refresh: () => void, destroy: () => void}}
 */
export function mountCodeHighlight(textarea, codeEl, opts = {}) {
	const pre = opts.pre || codeEl.closest('pre') || codeEl;
	let raf = 0;
	let timer = 0;
	const LARGE_CHARS = 20000;
	const INPUT_DEBOUNCE_MS = 100;
	const LARGE_DEBOUNCE_MS = 180;

	function syncScroll() {
		pre.scrollTop = textarea.scrollTop;
		pre.scrollLeft = textarea.scrollLeft;
	}

	function paint() {
		const v = textarea.value;
		// Huge layered scenes: escaping alone avoids multi-100KB HTML stalls.
		// Full tokenize still runs for typical / medium editors.
		if (v.length > 80000) {
			codeEl.textContent = v + '\n';
		} else {
			codeEl.innerHTML = highlightJs(v) + '\n';
		}
		syncScroll();
	}

	function cancelScheduled() {
		if (timer) { clearTimeout(timer); timer = 0; }
		if (raf) { cancelAnimationFrame(raf); raf = 0; }
	}

	function schedulePaint(delayMs) {
		cancelScheduled();
		if (delayMs <= 0) {
			raf = requestAnimationFrame(() => { raf = 0; paint(); });
			return;
		}
		timer = setTimeout(() => {
			timer = 0;
			raf = requestAnimationFrame(() => { raf = 0; paint(); });
		}, delayMs);
	}

	function refresh() {
		// Programmatic sync (layer/clear load): defer highlight so THREE scene
		// setup isn't competing with a huge innerHTML on the same turn.
		const len = textarea.value.length;
		schedulePaint(len > LARGE_CHARS ? LARGE_DEBOUNCE_MS : 0);
	}

	function onInput() {
		const len = textarea.value.length;
		schedulePaint(len > LARGE_CHARS ? LARGE_DEBOUNCE_MS : INPUT_DEBOUNCE_MS);
	}

	textarea.addEventListener('input', onInput);
	textarea.addEventListener('scroll', syncScroll);
	refresh();

	return {
		refresh,
		destroy() {
			cancelScheduled();
			textarea.removeEventListener('input', onInput);
			textarea.removeEventListener('scroll', syncScroll);
		}
	};
}
