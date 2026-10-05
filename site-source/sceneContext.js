/**
 * Compact scene-code context for chat (no extra API calls) +
 * helpers to package a public chat transcript with community uploads.
 *
 * Context text is attached only to the outbound API payload for a turn.
 * It must never be stored in message.content / displayText / transcripts.
 */

export const SCENE_CTX_PER_CAP = 5500;
export const SCENE_CTX_TOTAL_CAP = 8000;
export const SCENE_CTX_DELTA_CAP = 3000;
export const CHAT_TRANSCRIPT_CAP = 20000;

const LITERAL_ARRAY_RE = /(\[\s*(?:[^[\]\n]{0,60},\s*){7,}[^[\]\n]{0,60})[\s\S]*?(\])/g;
const LONG_STRING_RE = /(["'`])(?:\\.|(?!\1)[\s\S]){120,}\1/g;

/** Snapshot / delta piggyback markers (also used to strip leaks defensively). */
export const SCENE_CTX_SNAPSHOT_INTRO =
	'Currently loaded scene code (for context; modify or extend these objects rather than recreating them):';
export const SCENE_CTX_DELTA_INTRO = 'Scene changed since your last view:';

/**
 * Collapse source to a small structural summary for the model.
 * @param {string} source
 * @param {number} [maxChars]
 * @returns {string}
 */
export function trimSceneCode(source, maxChars = SCENE_CTX_PER_CAP) {
	let s = String(source ?? '');
	if (!s.trim()) return '';

	// Strip block + line comments
	s = s.replace(/\/\*[\s\S]*?\*\//g, '');
	s = s.replace(/(^|[^:])\/\/[^\n]*/g, '$1');

	// Shrink huge arrays / long string literals
	s = s.replace(LITERAL_ARRAY_RE, (_, head, close) => `${head.trim()} /*…*/ ${close}`);
	s = s.replace(LONG_STRING_RE, (m, q) => `${q}…${q}`);

	// Drop blank lines + collapse runs of spaces (keep newlines for structure)
	s = s
		.split('\n')
		.map(line => line.replace(/[ \t]+/g, ' ').trimEnd())
		.filter(line => line.trim().length > 0)
		.join('\n');

	if (s.length <= maxChars) return s;

	// Prefer keeping top-level declarations / constructors
	const keep = [];
	const lines = s.split('\n');
	const interesting = /^(?:(?:export\s+)?(?:async\s+)?function\b|const\s+\w+|let\s+\w+|var\s+\w+|class\s+\w+)|\b(?:new\s+THREE\.|scene\.add\s*\(|create|Group|Mesh|Material|Geometry|Box|Sphere|Plane|Cylinder|Light)/;
	const isHeader = (line) => /^---\s+.+(?:\s+---)$/.test(line.trim());
	for (const line of lines) {
		const t = line.trim();
		if (isHeader(t) || interesting.test(t) || /^(?:}|\);?|\]\);?)$/.test(t)) {
			keep.push(line);
		}
	}
	let out = keep.length >= 8 ? keep.join('\n') : s;
	if (out.length <= maxChars) return out;

	const head = Math.floor(maxChars * 0.72);
	const tail = Math.max(0, maxChars - head - 48);
	return (
		out.slice(0, head) +
		'\n/* … truncated for context … */\n' +
		(tail ? out.slice(-tail) : '')
	).slice(0, maxChars);
}

/**
 * @param {{ name?: string, code: string, communityKey?: string }[]} slots
 * @param {number} [totalCap]
 */
export function buildLoadedSceneSnapshot(slots, totalCap = SCENE_CTX_TOTAL_CAP) {
	if (!slots?.length) return '';
	const parts = [];
	let used = 0;
	const per = Math.min(SCENE_CTX_PER_CAP, Math.floor(totalCap / Math.min(slots.length, 3)));
	for (const slot of slots) {
		if (used >= totalCap) break;
		const budget = Math.min(per, totalCap - used);
		const body = trimSceneCode(slot.code, budget);
		if (!body) continue;
		const header = `--- ${slot.name || 'Scene'}${slot.communityKey ? ` [${slot.communityKey}]` : ''} ---`;
		const chunk = `${header}\n${body}`;
		if (used + chunk.length > totalCap && parts.length) break;
		parts.push(chunk.slice(0, totalCap - used));
		used += parts[parts.length - 1].length;
	}
	if (!parts.length) return '';
	return SCENE_CTX_SNAPSHOT_INTRO + '\n' + parts.join('\n\n');
}

/**
 * Keep --- scene headers when trimming delta fragments (trimSceneCode would
 * otherwise drop them as "uninteresting", which hid Layer names from the model).
 */
function trimDeltaFragment(source, maxChars) {
	const raw = String(source ?? '');
	const headers = raw
		.split('\n')
		.map(l => l.trim())
		.filter(l => /^---\s+.+(?:\s+---)$/.test(l));
	let body = trimSceneCode(raw, maxChars);
	const missing = headers.filter(h => !body.includes(h));
	if (missing.length) {
		body = (missing.join('\n') + '\n' + body).slice(0, maxChars);
	}
	return body;
}

/**
 * Cheap line-oriented delta between two already-trimmed snapshots.
 * @returns {string} empty if nothing useful
 */
export function buildSceneDelta(prevSnap, nextSnap, maxChars = SCENE_CTX_DELTA_CAP) {
	const a = String(prevSnap || '').split('\n').filter(Boolean);
	const b = String(nextSnap || '').split('\n').filter(Boolean);
	if (!b.length) return '';
	const setA = new Set(a);
	const setB = new Set(b);
	const added = b.filter(line => !setA.has(line));
	const removed = a.filter(line => !setB.has(line));
	if (!added.length && !removed.length) return '';

	const messy =
		added.length + removed.length > 80 ||
		(added.join('\n').length + removed.join('\n').length) > maxChars * 1.4;
	if (messy) return ''; // caller should fall back to full snapshot

	const parts = [SCENE_CTX_DELTA_INTRO];
	if (removed.length) {
		parts.push('Removed / replaced:');
		parts.push(trimDeltaFragment(removed.join('\n'), Math.floor(maxChars / 2)));
	}
	if (added.length) {
		parts.push('Added / updated:');
		parts.push(trimDeltaFragment(added.join('\n'), Math.floor(maxChars / 2)));
	}
	let out = parts.filter(Boolean).join('\n');
	if (out.length > maxChars) {
		out = out.slice(0, maxChars - 24) + '\n/* … delta truncated … */';
	}
	return out;
}

/**
 * Remove piggybacked scene-context blobs from text (defensive; prefer displayText).
 */
export function stripEmbeddedSceneContext(text) {
	let s = String(text ?? '');
	s = s.replace(/\s*\[scene context attached:[^\]]*\]/gi, '');

	const stripLeadingBlob = (intro) => {
		const idx = s.indexOf(intro);
		if (idx === -1) return;
		// Context is always a prefix joined with "\n\n" before the typed user text.
		// Drop from intro through the last context-looking chunk.
		const before = s.slice(0, idx);
		let rest = s.slice(idx);
		const parts = rest.split('\n\n');
		const isCtxPart = (p) => {
			const t = p.trim();
			return (
				t.startsWith(SCENE_CTX_SNAPSHOT_INTRO) ||
				t.startsWith(SCENE_CTX_DELTA_INTRO) ||
				/^---\s+.+(?:\s+---)$/m.test(t) ||
				/^(?:Removed \/ replaced:|Added \/ updated:)/m.test(t)
			);
		};
		while (parts.length && isCtxPart(parts[0])) parts.shift();
		s = (before + parts.join('\n\n')).trim();
	};

	stripLeadingBlob(SCENE_CTX_SNAPSHOT_INTRO);
	stripLeadingBlob(SCENE_CTX_DELTA_INTRO);
	return s.trim();
}

function stripSecretsAndMedia(text) {
	let s = String(text ?? '');
	s = s.replace(/sk-[A-Za-z0-9_\-]{10,}/g, '[redacted-key]');
	s = s.replace(/data:[a-z0-9.+/-]+;base64,[A-Za-z0-9+/=\s]+/gi, '[redacted-data-url]');
	s = s.replace(/https?:\/\/\S+\.(?:png|jpe?g|gif|webp|mp4)(\?\S*)?/gi, '[redacted-media-url]');
	return s;
}

function assistantForTranscript(content) {
	let s = stripSecretsAndMedia(content);
	// Replace fenced vr-exec / code blocks with a short marker (code lives in codeBlocks)
	s = s.replace(/```(?:vr-exec|js|javascript)?\s*[\s\S]*?```/gi, '[code block omitted — see scene codeBlocks]');
	s = s.replace(/\n{3,}/g, '\n\n').trim();
	if (s.length > 1200) s = s.slice(0, 1100) + '…';
	return s;
}

function userTextForTranscript(m) {
	// Prefer typed / display text — never the API piggyback payload.
	if (typeof m.displayText === 'string' && m.displayText.trim()) {
		return stripSecretsAndMedia(stripEmbeddedSceneContext(m.displayText));
	}
	if (typeof m.userText === 'string' && m.userText.trim()) {
		return stripSecretsAndMedia(stripEmbeddedSceneContext(m.userText));
	}
	const raw = m.content;
	if (typeof raw === 'string') {
		return stripSecretsAndMedia(stripEmbeddedSceneContext(raw));
	}
	if (Array.isArray(raw)) {
		const texts = raw
			.filter(p => p && p.type === 'text' && typeof p.text === 'string')
			.map(p => stripSecretsAndMedia(stripEmbeddedSceneContext(p.text)));
		const imgs = raw.filter(p => p && p.type === 'image').length;
		let out = texts.join('\n').trim() || '(no text)';
		if (imgs) out += `\n[${imgs} image attachment(s) omitted]`;
		return out;
	}
	return stripSecretsAndMedia(stripEmbeddedSceneContext(String(raw ?? '')));
}

/**
 * Build a compact public transcript from the live chat arrays.
 * Keeps earliest prompts + latest turns within CHAT_TRANSCRIPT_CAP.
 * @param {Array<{role:string, content:any, displayText?: string, userText?: string}>} apiMessages
 * @param {{ model?: string }} [opts]
 */
export function buildChatTranscript(apiMessages, opts = {}) {
	const model = opts.model || '';
	const turns = [];
	const now = new Date().toISOString();
	for (const m of apiMessages || []) {
		if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
		const content =
			m.role === 'user' ? userTextForTranscript(m) : assistantForTranscript(m.content);
		if (!content) continue;
		turns.push({
			role: m.role,
			content,
			ts: m.ts || now,
			...(m.role === 'assistant' && model ? { model } : {})
		});
	}
	if (!turns.length) return null;

	const pack = (list) => JSON.stringify({ version: 1, model, turns: list });
	let encoded = pack(turns);
	if (encoded.length <= CHAT_TRANSCRIPT_CAP) {
		return { version: 1, model, turns };
	}

	// Keep earliest 40% + latest remainder by character budget
	const earliest = [];
	const latest = [];
	let budget = Math.floor(CHAT_TRANSCRIPT_CAP * 0.92);
	let used = 40; // envelope
	for (const t of turns) {
		const piece = JSON.stringify(t).length + 1;
		if (used + piece > Math.floor(budget * 0.4)) break;
		earliest.push(t);
		used += piece;
	}
	for (let i = turns.length - 1; i >= earliest.length; i--) {
		const t = turns[i];
		const piece = JSON.stringify(t).length + 1;
		if (used + piece > budget) break;
		latest.unshift(t);
		used += piece;
	}
	const merged = earliest.concat(
		earliest.length + latest.length < turns.length
			? [{ role: 'assistant', content: '[…middle turns omitted…]', ts: now }]
			: [],
		latest
	);
	return { version: 1, model, turns: merged, truncated: true };
}

/**
 * Mutable controller for loaded-scene AI context + revision tracking.
 * All trim/diff work happens in consumeAttachmentForSend() only.
 */
export function createSceneContextController() {
	/** @type {{ communityKey: string, name: string, code: string }[]} */
	let slots = [];
	let revision = 0;
	let lastSeenRevision = -1;
	/** @type {string|null} null = lazy / not computed yet */
	let lastSeenSnapshot = null;
	let historyEpoch = 0; // bump when chat history is wiped
	let lastSeenHistoryEpoch = 0;
	let fromAiUntil = 0; // revision stamp: AI-owned edits up through this
	/** @type {{ name: string, communityKey: string, mode: string, atRevision: number }[]} */
	let pendingAttributions = [];

	function currentJoinedCode() {
		return slots.map(s => `// --- ${s.name} ---\n${s.code}`).join('\n\n');
	}

	function snapshotText() {
		return buildLoadedSceneSnapshot(slots);
	}

	function noteCommunityLoad(sc, { mode } = {}) {
		if (!sc) return;
		const key = sc.communityKey || (sc.id ? `id:${sc.id}` : `local:${sc.name}`);
		const code = Array.isArray(sc.codeBlocks) ? sc.codeBlocks.join('\n\n') : String(sc.codeBlocks || '');
		if (mode === 'layer') {
			const idx = slots.findIndex(s => s.communityKey === key);
			if (idx >= 0) {
				slots[idx] = { communityKey: key, name: sc.name || slots[idx].name, code };
			} else {
				slots.push({ communityKey: key, name: sc.name || 'Scene', code });
				while (slots.length > 4) slots.shift();
			}
		} else {
			slots = [{ communityKey: key, name: sc.name || 'Scene', code }];
			pendingAttributions = [];
		}
		revision += 1;
		pendingAttributions.push({
			name: sc.name || 'Scene',
			communityKey: key,
			mode: mode === 'layer' ? 'layered' : 'loaded',
			atRevision: revision
		});
	}

	function noteExternalMutation(joinedCode, name = 'Edited scene') {
		// Manual Apply / clear / other non-AI mutations of the live program.
		const key = slots[0]?.communityKey || 'session:live';
		if (!joinedCode || !String(joinedCode).trim()) {
			slots = [];
		} else if (slots.length <= 1) {
			slots = [{ communityKey: key, name: slots[0]?.name || name, code: String(joinedCode) }];
		} else {
			// Multi-slot: refresh a synthetic combined slot for deltas
			slots = [{ communityKey: 'session:combined', name: 'Active scenes', code: String(joinedCode) }];
		}
		revision += 1;
		// Code-tab Apply stays unnamed (no pendingAttributions push).
	}

	function noteAiMutation(joinedCode) {
		// AI vr-exec already lands in chat history — bump revision but mark as seen.
		// Do NOT trim/snapshot here (lazy: only at send time).
		const key = slots[0]?.communityKey || 'session:live';
		if (joinedCode && String(joinedCode).trim()) {
			if (slots.length <= 1) {
				slots = [{ communityKey: key, name: slots[0]?.name || 'Scene', code: String(joinedCode) }];
			} else {
				slots = [{ communityKey: 'session:combined', name: 'Active scenes', code: String(joinedCode) }];
			}
		}
		revision += 1;
		fromAiUntil = revision;
		lastSeenRevision = revision;
		lastSeenSnapshot = null; // lazy — treated as "in sync" via lastSeenRevision
		lastSeenHistoryEpoch = historyEpoch;
	}

	function clearAll() {
		slots = [];
		revision += 1;
		lastSeenRevision = -1;
		lastSeenSnapshot = null;
		fromAiUntil = 0;
		pendingAttributions = [];
	}

	function noteHistoryCleared() {
		historyEpoch += 1;
	}

	function formatAttributionHeaders(attrs) {
		return attrs
			.map(a => `--- ${a.name} [${a.communityKey}] (${a.mode}) ---`)
			.join('\n');
	}

	/**
	 * Build attachment for the next outbound user turn (or null).
	 * Marks context as consumed when it returns text.
	 * Trim/diff run ONLY here — never per frame / keystroke / load.
	 */
	function consumeAttachmentForSend() {
		if (!slots.length) {
			pendingAttributions = [];
			return null;
		}

		const historyLost = historyEpoch !== lastSeenHistoryEpoch;
		const neverSent = lastSeenRevision < 0;
		const changedExternally =
			revision !== lastSeenRevision && revision > fromAiUntil;

		// Unchanged since model last saw it (or only AI edits) — rely on history
		if (!neverSent && !historyLost && !changedExternally) {
			pendingAttributions = [];
			return null;
		}

		// Compute snapshot only when we actually need to attach something.
		const snap = snapshotText();
		if (!snap) {
			pendingAttributions = [];
			return null;
		}

		const attrs = pendingAttributions.slice();
		let text = null;
		let kind = 'snapshot';

		if (neverSent || historyLost) {
			text = snap;
			kind = 'snapshot';
		} else if (changedExternally) {
			const canDelta = typeof lastSeenSnapshot === 'string' && lastSeenSnapshot.length > 0;
			const delta = canDelta
				? buildSceneDelta(lastSeenSnapshot, snap, SCENE_CTX_DELTA_CAP)
				: '';
			if (delta) {
				kind = 'delta';
				if (attrs.length) {
					const headers = formatAttributionHeaders(attrs);
					const body = delta.startsWith(SCENE_CTX_DELTA_INTRO)
						? delta.slice(SCENE_CTX_DELTA_INTRO.length).replace(/^\n/, '')
						: delta;
					text = SCENE_CTX_DELTA_INTRO + '\n' + headers + (body ? '\n' + body : '');
				} else {
					text = delta;
				}
			} else {
				text = snap;
				kind = 'snapshot';
			}
		}

		lastSeenRevision = revision;
		lastSeenSnapshot = snap;
		lastSeenHistoryEpoch = historyEpoch;
		pendingAttributions = [];
		return text ? { text, kind, revision } : null;
	}

	function debugState() {
		return {
			slots: slots.map(s => ({ key: s.communityKey, name: s.name, codeLen: s.code.length })),
			revision,
			lastSeenRevision,
			historyEpoch,
			fromAiUntil,
			pendingAttributions: pendingAttributions.map(a => ({ ...a })),
			lastSeenSnapshotCached: lastSeenSnapshot != null
		};
	}

	return {
		noteCommunityLoad,
		noteExternalMutation,
		noteAiMutation,
		clearAll,
		noteHistoryCleared,
		consumeAttachmentForSend,
		snapshotText,
		currentJoinedCode,
		debugState,
		get revision() { return revision; },
		get slotCount() { return slots.length; }
	};
}
