// ==UserScript==
// @name         Rose Guns Days
// @version      1.0.5
// @author       Serichka
// @description  Steam — Seasons 1-2, dialogue text and character names
// * MangaGamer, 07th Expansion
// * Unity (Mono)
//
// https://store.steampowered.com/app/1528920/Rose_Guns_Days_Season_1/
// ==/UserScript==

'use strict';

const Mono = require('./libMono.js');

// A later continuation from the same textbox is sent as another line.
const handler = trans.send((text) => text, '200+');
let currentName = '';
let prefixNextText = false;
let preparingNameLayer = 0;

function cleanText(text) {
    return text
        .replace(/<[^>]*>/g, '')
        .replace(/\r\n?/g, '\n')
        .trim();
}

function setCurrentName(name, startsNewLine) {
    const nextName = cleanText(name);
    const nameChanged = nextName !== currentName;
    currentName = nextName;

    if (startsNewLine || nameChanged) {
        prefixNextText = currentName.length !== 0;
    }
}

function captureNameSprite(text) {
    const marker = '<align=center>';
    const markerPosition = text.lastIndexOf(marker);
    const name = markerPosition !== -1
        ? text.slice(markerPosition + marker.length)
        : text
            .replace(/^:s\/[^;]*;/, '')
            .replace(/^#[0-9a-f]{6,8}/i, '');

    // Redrawing layer 700 with the same name must not prefix a continuation.
    setCurrentName(name, false);
}

Mono.setHook('NScriptEngine', 'UI.BacklogWindow', 'LogName', -1, {
    onEnter(args) {
        setCurrentName(args[1].readMonoString(), true);
    }
});

// RGD displays the speaker with `lsph 700, ...`; layer 700 is the name sprite.
// PrepareTextLayer receives the unresolved "$0" template, so use it only to
// identify the nested TextLayer.SetText call that receives the actual name.
Mono.setHook('NScriptEngine', 'Display.DisplayManager', 'PrepareTextLayer', -1, {
    onEnter(args) {
        const layerId = args[1].toInt32();
        this.isNameLayer = layerId === 700;
        if (this.isNameLayer) preparingNameLayer++;
    },
    onLeave() {
        if (this.isNameLayer) preparingNameLayer--;
    }
});

Mono.setHook('NScriptEngine', 'Display.TextLayer', 'SetText', -1, {
    onEnter(args) {
        if (preparingNameLayer === 0) return;

        const text = args[1].readMonoString();
        if (/^\$\d+$/.test(cleanText(text))) return;
        captureNameSprite(text);
    }
});

Mono.setHook('NScriptEngine', 'Display.DisplayManager', 'ClearText', -1, {
    onEnter() {
        prefixNextText = currentName.length !== 0;
    }
});

Mono.setHook('NScriptEngine', 'Display.DisplayManager', 'AppendText', -1, {
    onEnter(args) {
        const text = cleanText(args[1].readMonoString());
        if (text.length === 0) return;

        if (prefixNextText) {
            handler(`${currentName}: ${text}`);
            prefixNextText = false;
        } else {
            handler(text);
        }
    }
});
