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
            // Only trigger if clicking on Start, End or Emoji fragments
            const isClickableFragment = target.classList.contains('cm-custom-highlight-start') ||
                                       target.classList.contains('cm-custom-highlight-end') ||
                                       target.classList.contains('cm-custom-highlight-emoji') ||
                                       target.classList.contains('cm-custom-highlight-clickable');

            if (isClickableFragment) {
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

                        menu.addItem((item) => {
                            item.setTitle("Highlight Color")
                                .setIcon("highlighter")
                                .setSection("format");

                            const subMenu = (item as any).setSubmenu();

                            Object.keys(this.settings.styles).forEach(emoji => {
                                subMenu.addItem((subItem: any) => {
                                    subItem.setTitle(`${emoji} ${getEmojiName(emoji)}`)
                                        .onClick(() => {
                                            editor.replaceRange(`==${emoji}${content}==`,
                                                { line: cursor.line, ch: start },
                                                { line: cursor.line, ch: end });
                                        });
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
                .cm-s-obsidian .${className},
                .cm-s-obsidian .cm-highlight.${className} {
                    background-color: ${style.backgroundColor} !important;
                    color: ${style.textColor} !important;
                    border: ${style.borderWidth} solid ${style.borderColor} !important;
                    border-radius: ${style.borderRadius} !important;
                    padding: 0;
                    /* Ensure background is clipped by border radius */
                    background-clip: padding-box !important;
                    box-decoration-break: slice !important;
                    -webkit-box-decoration-break: slice !important;
                    box-shadow: none !important;
                }

                /* Unified look for fragmented highlights */
                .cm-s-obsidian .${className}.cm-custom-highlight-start,
                .cm-s-obsidian .cm-highlight.${className}.cm-custom-highlight-start {
                    border-right: none !important;
                    border-top-right-radius: 0 !important;
                    border-bottom-right-radius: 0 !important;
                    padding-left: 2px !important;
                }
                .cm-s-obsidian .${className}.cm-custom-highlight-emoji,
                .cm-s-obsidian .cm-highlight.${className}.cm-custom-highlight-emoji {
                    border-left: none !important;
                    border-right: none !important;
                    border-radius: 0 !important;
                }
                .cm-s-obsidian .${className}.cm-custom-highlight-middle,
                .cm-s-obsidian .cm-highlight.${className}.cm-custom-highlight-middle {
                    border-left: none !important;
                    border-right: none !important;
                    border-radius: 0 !important;
                }
                .cm-s-obsidian .${className}.cm-custom-highlight-end,
                .cm-s-obsidian .cm-highlight.${className}.cm-custom-highlight-end {
                    border-left: none !important;
                    border-top-left-radius: 0 !important;
                    border-bottom-left-radius: 0 !important;
                    padding-right: 2px !important;
                }
            `;
        }
        css += `
            .cm-custom-highlight-hidden {
                display: none !important;
            }

            /* Disable native background when our custom highlight class is present */
            .cm-s-obsidian .cm-highlight[class*="highlight-"] {
                background-color: transparent !important;
                box-shadow: none !important;
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
                    // Match both with and without emoji
                    const regex = /==([🔴🟠🟡🟢🔵🟣⚫⚪🟤])?(.*?)(==)/gu;

                    let match;
                    while ((match = regex.exec(text)) !== null) {
                        const start = from + match.index;
                        const end = from + match.index + match[0].length;
                        const emoji = match[1];
                        const emojiName = emoji ? getEmojiName(emoji) : "";
                        const className = emoji ? `highlight-${emojiName}` : "";

                        // Clickable fragments even for standard highlights
                        const styleClass = className || "cm-custom-highlight-clickable";

                        const isCursorInside = selection.ranges.some(r => r.from <= end && r.to >= start);

                        if (isLivePreview && !isCursorInside && emoji) {
                            // Hidden markers when cursor is outside (only for custom highlights)
                            builder.add(start, start + 2 + emoji.length, Decoration.mark({ class: 'cm-custom-highlight-hidden' }));
                            builder.add(start + 2 + emoji.length, end - 2, Decoration.mark({ class: className }));
                            builder.add(end - 2, end, Decoration.mark({ class: 'cm-custom-highlight-hidden' }));
                        } else {
                            // Source Mode or Cursor Inside, or Standard Highlight: Unified look
                            const emojiLen = emoji ? emoji.length : 0;

                            builder.add(start, start + 2, Decoration.mark({
                                class: `${styleClass} cm-custom-highlight-start`
                            }));

                            if (emoji) {
                                builder.add(start + 2, start + 2 + emojiLen, Decoration.mark({
                                    class: `${styleClass} cm-custom-highlight-emoji`
                                }));
                            }

                            builder.add(start + 2 + emojiLen, end - 2, Decoration.mark({
                                class: `${styleClass} cm-custom-highlight-middle`
                            }));

                            builder.add(end - 2, end, Decoration.mark({
                                class: `${styleClass} cm-custom-highlight-end`
                            }));
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
        const line = editor.getLine(start.line);
        const rest = line.substring(end.ch);

        // Check if we are already inside some highlight markers
        // This happens during selection wrap or when editing an existing highlight
        const hasClosing = rest.includes('==');

        if (hasClosing) {
            // Check if we are replacing an existing emoji or just the ==
            const emojiRegex = /^[🔴🟠🟡🟢🔵🟣⚫⚪🟤]/u;
            const match = rest.match(emojiRegex);
            if (match) {
                editor.replaceRange(`==${value}`, start, { line: start.line, ch: end.ch + match[0].length });
            } else {
                editor.replaceRange(`==${value}`, start, end);
            }
        } else {
            // New highlight: add both opening and closing markers
            editor.replaceRange(`==${value}==`, start, end);
            // Position cursor between emoji and closing markers
            editor.setCursor({ line: start.line, ch: start.ch + 2 + value.length });
        }
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
