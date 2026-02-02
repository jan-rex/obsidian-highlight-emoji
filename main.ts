import { App, Plugin, PluginSettingTab, Setting, Editor, MarkdownView, EditorSuggest, EditorPosition, EditorSuggestTriggerInfo, EditorSuggestContext, TFile, Menu, editorLivePreviewField } from 'obsidian';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewUpdate, ViewPlugin } from '@codemirror/view';

interface HighlightStyle {
    backgroundColor: string;
    textColor: string;
    borderColor: string;
    borderWidth: string;
    borderRadius: string;
}

interface CustomHighlightSettings {
    styles: Record<string, HighlightStyle>;
}

const DEFAULT_STYLES: Record<string, HighlightStyle> = {
    "🔴": { backgroundColor: "#ff000033", textColor: "inherit", borderColor: "#ff0000", borderWidth: "1px", borderRadius: "4px" },
    "🟠": { backgroundColor: "#ffa50033", textColor: "inherit", borderColor: "#ffa500", borderWidth: "1px", borderRadius: "4px" },
    "🟡": { backgroundColor: "#ffff0033", textColor: "inherit", borderColor: "#ffff00", borderWidth: "1px", borderRadius: "4px" },
    "🟢": { backgroundColor: "#00800033", textColor: "inherit", borderColor: "#008000", borderWidth: "1px", borderRadius: "4px" },
    "🔵": { backgroundColor: "#0000ff33", textColor: "inherit", borderColor: "#0000ff", borderWidth: "1px", borderRadius: "4px" },
    "🟣": { backgroundColor: "#80008033", textColor: "inherit", borderColor: "#800080", borderWidth: "1px", borderRadius: "4px" },
    "⚫": { backgroundColor: "#00000033", textColor: "inherit", borderColor: "#000000", borderWidth: "1px", borderRadius: "4px" },
    "⚪": { backgroundColor: "#ffffff33", textColor: "inherit", borderColor: "#ffffff", borderWidth: "1px", borderRadius: "4px" },
    "🟤": { backgroundColor: "#a52a2a33", textColor: "inherit", borderColor: "#a52a2a", borderWidth: "1px", borderRadius: "4px" },
};

const DEFAULT_SETTINGS: CustomHighlightSettings = {
    styles: DEFAULT_STYLES
};

const emojiMap: Record<string, string> = {
    "🔴": "red", "🟠": "orange", "🟡": "yellow", "🟢": "green",
    "🔵": "blue", "🟣": "purple", "⚫": "black", "⚪": "white", "🟤": "brown"
};

function getEmojiName(emoji: string): string {
    return emojiMap[emoji] || "default";
}

export default class CustomHighlightPlugin extends Plugin {
    settings!: CustomHighlightSettings;
    styleElement!: HTMLStyleElement;

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new CustomHighlightSettingTab(this.app, this));

        this.styleElement = document.createElement('style');
        this.styleElement.id = 'custom-highlights-styles';
        document.head.appendChild(this.styleElement);
        this.updateStyles();

        this.registerEditorExtension(this.createHighlightExtension());
        this.registerEditorSuggest(new ColorSuggest(this.app, this));

        this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
            const target = evt.target as HTMLElement;
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view) return;

            // Handle highlight click to change color
            // Check if we clicked on a custom highlight (Live Preview) or rendered highlight (Reading Mode)
            const isCustomHighlight = Array.from(target.classList).some(cls => cls.startsWith('highlight-'));

            if (isCustomHighlight) {
                const editor = view.editor;
                // @ts-ignore
                const cm = editor.cm;
                if (!cm) return;

                const pos = cm.posAtDOM(target);
                const lineNum = editor.offsetToPos(pos).line;
                const line = editor.getLine(lineNum);
                const lineOffset = editor.posToOffset({ line: lineNum, ch: 0 });

                const regex = /==([🔴🟠🟡🟢🔵🟣⚫⚪🟤])?(.*?)(==)/gu;
                let match;
                while ((match = regex.exec(line)) !== null) {
                    const start = match.index;
                    const end = match.index + match[0].length;
                    const relativePos = pos - lineOffset;

                    // If we clicked within a highlight
                    if (relativePos >= start && relativePos <= end) {
                        // Check if we clicked near the start (the emoji part)
                        // In Live Preview, the emoji is at relativePos match.index + 2
                        const isNearStart = relativePos <= start + 5;

                        if (isNearStart) {
                            const content = match[2];
                            const menu = new Menu();
                            Object.keys(this.settings.styles).forEach(emoji => {
                                menu.addItem((item) => {
                                    item.setTitle(`${emoji} ${getEmojiName(emoji)}`)
                                        .onClick(() => {
                                            editor.replaceRange(`==${emoji}${content}==`,
                                                editor.offsetToPos(lineOffset + start),
                                                editor.offsetToPos(lineOffset + end));
                                        });
                                });
                            });
                            menu.showAtMouseEvent(evt);
                            evt.preventDefault();
                            break;
                        }
                    }
                }
            }
        });

        this.registerEvent(
            this.app.workspace.on("editor-menu", (menu, editor, view) => {
                const cursor = editor.getCursor();
                const line = editor.getLine(cursor.line);

                // Match both colored highlights and normal highlights
                const regex = /==([🔴🟠🟡🟢🔵🟣⚫⚪🟤])?(.*?)(==)/gu;
                let match;
                while ((match = regex.exec(line)) !== null) {
                    const start = match.index;
                    const end = match.index + match[0].length;
                    if (cursor.ch >= start && cursor.ch <= end) {
                        const content = match[2];

                        Object.keys(this.settings.styles).forEach(emoji => {
                            menu.addItem((item) => {
                                item.setTitle(`${emoji} ${getEmojiName(emoji)}`)
                                    .setIcon("highlighter")
                                    .onClick(() => {
                                        editor.replaceRange(`==${emoji}${content}==`,
                                            { line: cursor.line, ch: start },
                                            { line: cursor.line, ch: end });
                                    });
                            });
                        });
                        break;
                    }
                }
            })
        );

        this.addCommand({
            id: 'apply-custom-highlight',
            name: 'Apply Custom Highlight to Selection',
            editorCallback: (editor: Editor) => {
                const selection = editor.getSelection();
                if (selection) {
                    // Wrap selection and trigger suggest by adding ==
                    editor.replaceSelection(`==${selection}==`);
                    const cursor = editor.getCursor();
                    // Move cursor to just after the first == to trigger suggest
                    editor.setCursor({ line: cursor.line, ch: cursor.ch - selection.length - 2 });
                    // We need to trigger it manually or wait for user to type something.
                    // Actually, typing == triggers it.
                    // Let's just wrap it with a default or let the suggest trigger.
                } else {
                    editor.replaceSelection("==");
                }
            }
        });

        this.registerMarkdownPostProcessor((element, context) => {
            const marks = element.querySelectorAll('mark');
            marks.forEach((mark) => {
                const text = mark.textContent || '';
                for (const emoji of Object.keys(this.settings.styles)) {
                    if (text.startsWith(emoji)) {
                        const className = `highlight-${getEmojiName(emoji)}`;
                        mark.classList.add(className);

                        // Remove emoji from the beginning
                        let innerHTML = mark.innerHTML;
                        if (innerHTML.startsWith(emoji)) {
                            mark.innerHTML = innerHTML.substring(emoji.length);
                        }
                        break;
                    }
                }
            });
        });

        console.log('Loading Custom Highlight Plugin');
    }

    onunload() {
        if (this.styleElement) {
            this.styleElement.remove();
        }
        console.log('Unloading Custom Highlight Plugin');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.updateStyles();
    }

    updateStyles() {
        let css = '';
        for (const [emoji, style] of Object.entries(this.settings.styles)) {
            const className = `highlight-${getEmojiName(emoji)}`;
            css += `
                .markdown-rendered .${className},
                .cm-s-obsidian .${className} {
                    background-color: ${style.backgroundColor} !important;
                    color: ${style.textColor} !important;
                    border: ${style.borderWidth} solid ${style.borderColor} !important;
                    border-radius: ${style.borderRadius} !important;
                    padding: 0 2px;
                    box-decoration-break: slice;
                    -webkit-box-decoration-break: slice;
                }

                /* Unified look when active in Live Preview by removing internal borders/radii on fragments */
                .cm-s-obsidian .${className}.cm-custom-highlight-active {
                    border-left: none !important;
                    border-right: none !important;
                    border-radius: 0 !important;
                }

                /* Re-add borders only to the outer edges of the active highlight if we could,
                   but since fragments are many, we target the formatting markers specifically if possible,
                   or just use a more subtle style for the active state. */
                .cm-s-obsidian .${className}.cm-custom-highlight-active:first-of-type {
                    /* This doesn't reliably work for spans, but we'll use a better approach:
                       Applying the border to the whole range and letting it slice. */
                }
            `;
        }
        css += `
            .cm-custom-highlight-hidden {
                display: none !important;
            }
            /* Try to force a unified box-decoration */
            .cm-s-obsidian span[class*="highlight-"] {
                box-decoration-break: slice;
                -webkit-box-decoration-break: slice;
            }
        `;
        this.styleElement.textContent = css;
    }

    createHighlightExtension() {
        return ViewPlugin.fromClass(class {
            decorations: DecorationSet;

            constructor(view: EditorView) {
                this.decorations = this.buildDecorations(view);
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged || update.selectionSet) {
                    this.decorations = this.buildDecorations(update.view);
                }
            }

            buildDecorations(view: EditorView): DecorationSet {
                const builder = new RangeSetBuilder<Decoration>();
                const selection = view.state.selection;
                const isLivePreview = view.state.field(editorLivePreviewField);

                for (const { from, to } of view.visibleRanges) {
                    const text = view.state.doc.sliceString(from, to);
                    const regex = /==([🔴🟠🟡🟢🔵🟣⚫⚪🟤])(.*?)(==)/gu;

                    let match;
                    while ((match = regex.exec(text)) !== null) {
                        const start = from + match.index;
                        const end = from + match.index + match[0].length;
                        const emoji = match[1];
                        const emojiName = getEmojiName(emoji);
                        const className = `highlight-${emojiName}`;

                        const isCursorInside = selection.ranges.some(r => r.from <= end && r.to >= start);

                        if (isLivePreview) {
                            if (isCursorInside) {
                                // Unified box when cursor is inside
                                // Avoid adding multiple overlapping decorations to prevent fragmented borders
                                builder.add(start, end, Decoration.mark({
                                    class: `${className} cm-custom-highlight-active`
                                }));
                            } else {
                                // Hidden markers when cursor is outside
                                builder.add(start, start + 2 + emoji.length, Decoration.mark({ class: 'cm-custom-highlight-hidden' }));
                                builder.add(start + 2 + emoji.length, end - 2, Decoration.mark({ class: className }));
                                builder.add(end - 2, end, Decoration.mark({ class: 'cm-custom-highlight-hidden' }));
                            }
                        } else {
                            // Source Mode: just style the content, don't hide anything
                            builder.add(start, end, Decoration.mark({ class: className }));
                        }
                    }
                }
                return builder.finish();
            }
        }, {
            decorations: v => v.decorations
        });
    }
}

class ColorSuggest extends EditorSuggest<string> {
    plugin: CustomHighlightPlugin;

    constructor(app: App, plugin: CustomHighlightPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
        const line = editor.getLine(cursor.line);
        const sub = line.substring(0, cursor.ch);

        // Trigger only if we just typed == at the start of a word/line
        // This prevents triggering on the closing == of a highlight
        const match = sub.match(/(?:^|\s)==([^=🔴🟠🟡🟢🔵🟣⚫⚪🟤]*)$/);
        if (match) {
            const query = match[1];
            return {
                start: { line: cursor.line, ch: cursor.ch - (query.length + 2) },
                end: cursor,
                query: query
            };
        }
        return null;
    }

    getSuggestions(context: EditorSuggestContext): string[] {
        const query = context.query.toLowerCase();
        return Object.keys(this.plugin.settings.styles).filter(emoji =>
            getEmojiName(emoji).toLowerCase().includes(query)
        );
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        const name = getEmojiName(value);
        el.createEl('div', { text: `${value} ${name}` });
    }

    selectSuggestion(value: string, evt: MouseEvent | KeyboardEvent): void {
        const { editor, start, end } = this.context!;
        const replacement = `==${value}==`;
        editor.replaceRange(replacement, start, end);
        // Move cursor between the emoji and the closing ==
        editor.setCursor({ line: start.line, ch: start.ch + 2 + value.length });
    }
}

class CustomHighlightSettingTab extends PluginSettingTab {
    plugin: CustomHighlightPlugin;

    constructor(app: App, plugin: CustomHighlightPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Custom Highlight Styles' });

        for (const [emoji, style] of Object.entries(this.plugin.settings.styles)) {
            containerEl.createEl('h3', { text: `${emoji} ${getEmojiName(emoji).toUpperCase()}` });

            new Setting(containerEl)
                .setName('Background Color')
                .addText(text => text
                    .setValue(style.backgroundColor)
                    .onChange(async (value) => {
                        style.backgroundColor = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('Text Color')
                .addText(text => text
                    .setValue(style.textColor)
                    .onChange(async (value) => {
                        style.textColor = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('Border Color')
                .addText(text => text
                    .setValue(style.borderColor)
                    .onChange(async (value) => {
                        style.borderColor = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('Border Width')
                .addText(text => text
                    .setValue(style.borderWidth)
                    .onChange(async (value) => {
                        style.borderWidth = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('Border Radius')
                .addText(text => text
                    .setValue(style.borderRadius)
                    .onChange(async (value) => {
                        style.borderRadius = value;
                        await this.plugin.saveSettings();
                    }));
        }
    }
}
