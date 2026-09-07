// ==UserScript==
// @name         My Dearest Direst Disaster / 最悪なる災厄人間に捧ぐ
// @version      2.0.1
// @author       Codex
// @description  PC Unity — original IL2CPP release and 2026 Mono/JIT remake
// ==/UserScript==

'use strict';

const Mono = require('./libMono.js');
const VERSION = '2.0.1';
const sendText = trans.send(text => text, '200+');

const DEDUPE_MS = 30000;
const NAME_PAIR_MS = 180;
const recent = new Map();

let pendingDialogue = '';
let dialogueTimer = null;
let pendingSpeaker = '';
let speakerTimer = null;

let choiceTimer = null;
const choices = [];

console.log('[MD3 hook] version ' + VERSION);

function clean(raw) {
    if (typeof raw !== 'string' || !raw) return '';

    return raw
        .replace(/%rbs([^{}%]+)\{[^{}]*\}%rbe/gi, '$1')
        .replace(/%rbs|%rbe/gi, '')
        .replace(/%co\d+|%coe/gi, '')
        .replace(/[%$](?:dts|dte)/gi, '')
        .replace(/([\u3400-\u9fff]+)[(（][\u3040-\u30ffー]+[)）]/gu, '$1')
        .replace(/@n/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\\r?\\n/g, ' ')
        .replace(/\r?\n/g, ' ')
        .replace(/[ \t\u3000]{2,}/g, ' ')
        .trim();
}

function isJapanese(text) {
    return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u.test(text);
}

function isUseful(text) {
    if (!text || text.length < 2) return false;
    if (/^[\d\s.,:;!?+\-*/%()[\]{}<>_=]+$/.test(text)) return false;
    if (/^(loading|now loading|auto|skip|save|load|config|system)$/i.test(text)) return false;
    return isJapanese(text);
}

function isUnknownName(text) {
    return /^[?？]{2,}$/u.test(text);
}

function looksLikeName(text) {
    return isUnknownName(text) || (
        text.length <= 12
        && !/[「」『』（）()。！？!?、,.…]/u.test(text)
        && !/\s/u.test(text)
    );
}

function deliver(text) {
    if (!text) return;

    const now = Date.now();
    const previous = recent.get(text) || 0;
    if (now - previous < DEDUPE_MS) return;

    recent.set(text, now);
    for (const [oldText, time] of recent) {
        if (now - time > DEDUPE_MS) recent.delete(oldText);
    }

    sendText(text);
}

function flushDialogue() {
    if (!pendingDialogue) return;
    const text = pendingDialogue;
    pendingDialogue = '';
    dialogueTimer = null;
    deliver(text);
}

function rememberSpeaker(name) {
    pendingSpeaker = name;
    clearTimeout(speakerTimer);
    speakerTimer = setTimeout(() => {
        pendingSpeaker = '';
        speakerTimer = null;
    }, 1000);
}

function deliverNamed(name, dialogue) {
    clearTimeout(dialogueTimer);
    clearTimeout(speakerTimer);
    pendingDialogue = '';
    dialogueTimer = null;
    pendingSpeaker = '';
    speakerTimer = null;
    deliver(name + '\n' + dialogue);
}

function handleDialogue(raw) {
    const text = clean(raw);
    if (!isUseful(text)) return;

    if (pendingSpeaker) {
        deliverNamed(pendingSpeaker, text);
        return;
    }

    if (pendingDialogue && pendingDialogue !== text) flushDialogue();
    if (pendingDialogue === text) return;

    pendingDialogue = text;
    clearTimeout(dialogueTimer);
    dialogueTimer = setTimeout(flushDialogue, NAME_PAIR_MS);
}

function handleSpeaker(raw) {
    const name = clean(raw);
    if (!name) {
        pendingSpeaker = '';
        clearTimeout(speakerTimer);
        return;
    }
    if ((!isUseful(name) && !isUnknownName(name)) || !looksLikeName(name)) return;

    if (pendingDialogue) {
        deliverNamed(name, pendingDialogue);
    } else {
        rememberSpeaker(name);
    }
}

function readManagedString(value) {
    if (typeof value === 'string') return value;
    if (!value) return '';

    try {
        if (value.isNull()) return '';
    } catch (_) {}

    try {
        const text = value.readMonoString();
        if (typeof text === 'string' && text.length < 10000) return text;
    } catch (_) {}

    try {
        const inner = value.value;
        if (typeof inner === 'string') return inner;
        const text = inner.readMonoString();
        if (typeof text === 'string' && text.length < 10000) return text;
    } catch (_) {}

    return '';
}

function readFieldString(instance, fieldName) {
    try {
        return readManagedString(instance.wrap()[fieldName].getValue());
    } catch (_) {
        return '';
    }
}

function addChoice(raw) {
    const text = clean(raw);
    if (!isUseful(text) || choices.includes(text)) return;
    choices.push(text);

    clearTimeout(choiceTimer);
    choiceTimer = setTimeout(() => {
        if (!choices.length) return;
        deliver(choices.splice(0).join(' | '));
    }, 250);
}

function readStringCollection(value, typeName) {
    if (!value) return 0;
    try {
        if (value.isNull()) return 0;
    } catch (_) {}

    let object;
    try {
        object = value.wrap();
        if (/List/i.test(typeName)) object = object.ToArray().wrap();
    } catch (_) {
        return 0;
    }

    let found = 0;
    const consume = item => {
        const text = readManagedString(item);
        if (!text) return;
        addChoice(text);
        found++;
    };

    try {
        for (const item of object) consume(item);
        return found;
    } catch (_) {}

    try {
        const values = object.value;
        for (const item of values) consume(item);
    } catch (_) {}

    return found;
}

function getOverloads(clazz, methodName) {
    try {
        const group = clazz.methods[methodName];
        return group ? Object.values(group) : [];
    } catch (_) {
        const method = clazz.findMethod(methodName, -1);
        return method ? [method] : [];
    }
}

function hookRemakeDialogue() {
    const manager = Mono.findClass('', 'MessageManager');
    if (!manager) return false;

    const mes = manager.findMethod('Mes', 2);
    const mesName = manager.findMethod('MesName', 2);
    if (!mes || !mesName) return false;

    Mono.setHook(mes, {
        onEnter(args) {
            handleDialogue(readManagedString(args[1]));
        }
    });

    Mono.setHook(mesName, {
        onEnter(args) {
            handleSpeaker(readManagedString(args[1]));
        }
    });

    console.log('[MD3 hook] enabled: remake MessageManager.Mes + MesName');
    return true;
}

function hookLegacyDialogue() {
    const message = Mono.findClass('', 'Message');
    if (!message) return false;

    const mes = message.findMethod('Mes', -1);
    if (!mes) return false;

    Mono.setHook(mes, {
        onEnter(args) {
            this.instance = args[0];
            this.items = [];
            for (let i = 1; i <= 6; i++) {
                const text = readManagedString(args[i]);
                if (text) this.items.push(text);
            }
        },
        onLeave() {
            if (!this.instance) return;
            this.items.push(readFieldString(this.instance, 'LastMes'));
            this.items.push(readFieldString(this.instance, 'MessageText'));

            const unique = [];
            for (const raw of this.items) {
                const text = clean(raw);
                if ((!isUseful(text) && !isUnknownName(text)) || unique.includes(text)) continue;
                unique.push(text);
            }

            const dialogue = unique
                .filter(text => !looksLikeName(text))
                .sort((a, b) => b.length - a.length)[0];
            const name = unique.find(text => text !== dialogue && looksLikeName(text));

            if (dialogue) handleDialogue(dialogue);
            if (name) handleSpeaker(name);
        }
    });

    console.log('[MD3 hook] enabled: legacy Message.Mes');
    return true;
}

function hookChoices() {
    const mainScene = Mono.findClass('', 'MainScene');
    if (!mainScene) return false;

    const all = getOverloads(mainScene, 'SelectButton')
        .filter(method => method.args.some(type => /System\.String\[\]/i.test(type)));
    if (!all.length) return false;

    // The remake's ten-argument overload receives the final visible captions.
    // Older builds only expose the script-command overload, so keep it as fallback.
    const rendered = all.filter(method => method.args.length > 1);
    const targets = rendered.length ? rendered : all;

    for (const method of targets) {
        const types = method.args.slice();
        Mono.setHook(method, {
            onEnter(args) {
                let found = 0;
                for (let i = 0; i < types.length; i++) {
                    if (!/System\.String\[\]/i.test(types[i])) continue;
                    found += readStringCollection(args[i + 1], types[i]);
                }
                if (found) console.log('[MD3 hook] choices found: ' + found);
            }
        });
        console.log('[MD3 hook] choice signature: (' + types.join(', ') + ')');
    }

    return true;
}

Mono.perform(() => {
    let dialogueReady = false;

    try {
        dialogueReady = hookRemakeDialogue();
    } catch (error) {
        console.warn('[MD3 hook] remake hook failed: ' + error);
    }

    if (!dialogueReady) {
        try {
            dialogueReady = hookLegacyDialogue();
        } catch (error) {
            console.warn('[MD3 hook] legacy hook failed: ' + error);
        }
    }

    try {
        if (!hookChoices()) console.warn('[MD3 hook] choice hook unavailable');
    } catch (error) {
        console.warn('[MD3 hook] choice hook failed: ' + error);
    }

    if (dialogueReady) {
        console.log('[MD3 hook] ready');
    } else {
        console.error('[MD3 hook] no supported dialogue class found');
    }
});
