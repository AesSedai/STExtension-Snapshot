//Snapshot Javascript Code
import { SlashCommandParser } from '/scripts/slash-commands/SlashCommandParser.js';
import { SlashCommand } from '/scripts/slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from '/scripts/slash-commands/SlashCommandArgument.js';
import { callPopup } from '/script.js';
import { domToBlob } from './lib/modern-screenshot.mjs';

const extensionName = "Snapshot"
const isMobileDevice = window.innerWidth <= 768;
let useMobileMode = isMobileDevice;

const SNAPSHOT_DEBUG = false;

async function captureChatLog(format = 'regular', messageRange = null, anonymizeUser = false, anonymizeStylesheet = false, showReasoning = false) {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) {
        console.error("Chat log container not found.");
        return;
    }

    let userName = "Anon";
    if (chatContainer.querySelector(".mes[is_user=true] .name_text")) {
        userName = chatContainer.querySelector(".mes[is_user=true] .name_text").textContent;
    }

    //We back them up so we can add them back in later, if we need to
    const customCssBackup = document.getElementById("custom-style");
    const toggleCssBackup = document.head.querySelector("[href=\"css/toggle-dependent.css\"]");
    if (anonymizeStylesheet) {
        document.head.removeChild(document.getElementById("custom-style"));
        document.head.removeChild(document.head.querySelector("[href=\"css/toggle-dependent.css\"]"));

        const style = document.createElement("style");
        style.id = "snapshot-anonymizer-style";
        //Hide timestamp, hide buttons, hide the copy paste icon on the corner of <code> tags
        //Show the token count
        style.textContent = `
            small.timestamp, div.mes_buttons, code>.fa-solid.fa-copy.code-copy {
                display: none !important;
            }

            div.tokenCounterDisplay {
                display: block;
            }
        `;

        document.head.appendChild(style);
    }

    try {
        //First of all, we create a container and set its style properly.
        //In list mode we keep it as a plain block container so messages stack
        //via natural block flow — the old flex-row wrapper interacted badly
        //with body's `height: 100vh` and collapsed the captured height.
        const containerDiv = document.createElement("div");
        containerDiv.style.display = format === 'grid' ? 'flex' : 'block';
        containerDiv.style.width = 'max-content';
        if (anonymizeStylesheet) {
            //Why yes, I copied all of these from my personal theme, how could you tell?
            containerDiv.style.setProperty("--doc-height", "732 px");
            containerDiv.style.setProperty("--fontScale", "1");
            containerDiv.style.setProperty("--sheldWidth", "50vw");
            containerDiv.style.setProperty("--blurStrength", "1");
            containerDiv.style.setProperty("--shadowWidth", "2");
            containerDiv.style.setProperty("--SmartThemeBodyColor", "rgba(220, 220, 210, 1)");
            containerDiv.style.setProperty("--SmartThemeEmColor", "rgba(145, 145, 145, 1)");
            containerDiv.style.setProperty("--SmartThemeUnderlineColor", "rgba(188, 231, 207, 1)");
            containerDiv.style.setProperty("--SmartThemeQuoteColor", "rgba(221, 113, 248, 1)");
            containerDiv.style.setProperty("--SmartThemeBlurTintColor", "rgba(23, 23, 23, 1)");
            containerDiv.style.setProperty("--SmartThemeChatTintColor", "rgba(23, 23, 23, 1)");
            containerDiv.style.setProperty("--SmartThemeUserMesBlurTintColor", "rgba(30, 30, 30, 0.9)");
            containerDiv.style.setProperty("--SmartThemeBotMesBlurTintColor", "rgba(30, 30, 30, 0.9)");
            containerDiv.style.setProperty("--SmartThemeShadowColor", "rgba(0, 0, 0, 1)");
            containerDiv.style.setProperty("--SmartThemeBorderColor", "rgba(0, 0, 0, 0.5)");

            //--SmartThemeChatTintColor
            //No, seriously
            containerDiv.style.backgroundColor = "rgba(23, 23, 23, 1)";
        } else {
            containerDiv.style.backgroundColor = window.getComputedStyle(chatContainer).backgroundColor;
        }

        //Then we create a grid and set its style. We'll put inside this inside the container in a minute
        const gridDiv = document.createElement("div");
        gridDiv.style.padding = "15px";
        if (format === 'grid') {
            gridDiv.style.display = 'flex';
            gridDiv.style.flexDirection = 'column';
            gridDiv.style.flexWrap = 'wrap';
            gridDiv.style.justifyContent = 'space-between';
        } else {
            // Plain block stacking. Flex-column-wrap interacted with body's
            // `height: 100vh` and reflowed messages into multiple short
            // columns, collapsing the captured height to ~45px.
            gridDiv.style.display = 'block';
        }

        // Sane width fallback. When the UI dialog opens, the chat is
        // overlaid by ST's popup and individual `.mes` elements can briefly
        // report `scrollWidth === 0`, which would otherwise produce a tiny
        // capture. The slash command path doesn't hit this because it runs
        // without a popup.
        const fallbackWidth = chatContainer.offsetWidth || chatContainer.scrollWidth || 800;

        //Clone the messageElements so we don't mess them up on accident. Anonymize shit if necessary.
        //Filter by the mesid attribute (= the message's true index in the chat),
        //not the DOM-order index from querySelectorAll — ST only mounts the
        //last 50 messages on a fresh load, so DOM index drifts from mesid.
        const allMessages = Array.from(chatContainer.querySelectorAll(".mes"));
        const filteredMessages = allMessages.filter((el) => {
            const mesid = Number.parseInt(el.getAttribute('mesid'), 10);
            if (Number.isNaN(mesid)) return false;

            //If the message range is just a number, we pick that message
            if (/^\d+$/.test(messageRange)) {
                return mesid === Number.parseInt(messageRange, 10);
            }

            //If it's a range, we take all of those, closed on both sides
            if (/^\d+-\d+$/.test(messageRange)) {
                const interval = messageRange.split("-").map(s => Number.parseInt(s, 10));
                return mesid >= interval[0] && mesid <= interval[1];
            }

            //Otherwise we pull everything that's loaded
            return true;
        });

        if (messageRange && filteredMessages.length === 0) {
            console.warn(`[Snapshot] No messages match range "${messageRange}".`);
            return;
        }

        const messageElements = filteredMessages.map(el => {
            const clone = el.cloneNode(true);
            if (anonymizeStylesheet || useMobileMode) {
                clone.style.width = '800px';
            } else {
                clone.style.width = `${el.scrollWidth || el.offsetWidth || fallbackWidth}px`;
            }

            if (anonymizeUser) {
                if (clone.getAttribute('is_user') === 'true') {
                    clone.querySelector('.avatar img').src = 'data:image/png;base64,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';
                    clone.querySelector('.name_text').textContent = 'Anon';
                }

                const mesText = clone.querySelector('.mes_text');
                if (mesText) {
                    mesText.innerHTML = mesText.innerHTML.replace(new RegExp(userName, 'g'), 'Anon');
                }
            }

            // Reasoning blocks: either expand them fully or strip them out.
            const reasoningDetails = clone.querySelectorAll('.mes_reasoning_details');
            reasoningDetails.forEach(d => {
                if (showReasoning) {
                    d.setAttribute('open', '');
                } else {
                    d.remove();
                }
            });

            return clone;
        });

        messageElements.forEach(el => gridDiv.appendChild(el));

        containerDiv.appendChild(gridDiv);

        document.body.appendChild(containerDiv);

        //Thankfully we only need to do this much for grid mode
        if (format === 'grid') {
            //Tallest message's height
            const maxMesHeight = Math.max(...Array.from(gridDiv.childNodes).map(el => el.scrollHeight + 30));
            //Or the square root of the grid area, so it's square-ish
            gridDiv.style.maxHeight = `${Math.max(maxMesHeight, Math.ceil(Math.sqrt(gridDiv.scrollWidth * gridDiv.scrollHeight)))}px`
            containerDiv.style.height = `${gridDiv.offsetHeight}px`;
        } else {
            // List mode: stamp explicit dimensions from the laid-out clones so
            // capture doesn't rely on `width: max-content` resolving correctly
            // (which collapses to ~45px when ST's popup overlay is active).
            void containerDiv.offsetHeight; // force layout
            const clones = Array.from(gridDiv.children);
            const maxChildWidth = Math.max(...clones.map(el => el.offsetWidth || 0), 0);
            const totalChildHeight = clones.reduce((sum, el) => sum + (el.offsetHeight || 0), 0);
            if (maxChildWidth > 0) {
                containerDiv.style.width = `${maxChildWidth + 30}px`;
            }
            if (totalChildHeight > 0) {
                containerDiv.style.height = `${totalChildHeight + 30}px`;
            }
        }

        //In debug mode, we just drop the whole thing in body so we can inspect
        //the genned CSS without wrangling canvas
        if (SNAPSHOT_DEBUG) {
            while (document.body.firstChild) {
                document.body.removeChild(document.body.firstChild);
            }

            document.body.appendChild(containerDiv);
            return;
        }

        // modern-screenshot uses SVG <foreignObject> to hand the cloned DOM to the
        // browser's native renderer — far faster than html2canvas's JS rasterizer,
        // and it correctly honors <details> open/closed state so collapsed
        // reasoning blocks no longer overlap the message body.
        // Force a layout flush so getBoundingClientRect reflects post-clone sizes.
        void containerDiv.offsetHeight;
        const imgBlob = await domToBlob(containerDiv, {
            backgroundColor: containerDiv.style.backgroundColor,
            scale: window.devicePixelRatio || 1,
            type: 'image/png',
        });

        //Funny code to download files genned with JS, bog standard
        const link = document.createElement('a');
        link.href = URL.createObjectURL(imgBlob);
        link.download = 'chatlog.png';
        toastr.success('Chat log captured successfully!', 'Success');
        document.body.appendChild(link);
        link.click();

        document.body.removeChild(link);
        document.body.removeChild(containerDiv);
    } catch (error) {
        console.error("Error capturing chat log:", error);
        toastr.error('Failed, Please check the browser console. Common issues are no internet, or CORS policy.');
    } finally {
        if (anonymizeStylesheet && !SNAPSHOT_DEBUG) {
            document.head.removeChild(document.getElementById("snapshot-anonymizer-style"));
            document.head.appendChild(customCssBackup);
            document.head.appendChild(toggleCssBackup);
        }
    }
}

async function openSnapshotMenu() {
  const html = `
    <div class="wide100p">
      <h3>Snapshot</h3>
      <div class="flex-container flexFlowColumn" style="display: flex; justify-content: center; align-items: center;">
        <h4>Take a snapshot of the chat log.</h4>
        <div class="flex-container">
          <button id="snapshot_regular_button" class="btn btn-primary menu_button snapshot-button">
            <i class="fa-solid fa-bars"></i> List Snapshot
          </button>
          <button id="snapshot_grid_button" class="btn btn-primary menu_button snapshot-button">
            <i class="fa-solid fa-th"></i> Grid Snapshot
          </button>
        </div>
        <hr>
        <h5>- Optional - </h5>
        <div class="flex-container" style="margin-top: 10px; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center;">
            <label for="message_range_input">Specify Range:</label>
            <input type="text" id="message_range_input" class="snapshot-range-input" placeholder="e.g., 1-10" style="margin-left: 5px; width: 100px;">
          </div>
          <hr style="border: none; border-left: 1px solid #ccc; height: 20px; margin: 0 10px;">
          <div style="display: flex; align-items: center;">
            <label for="mobile_mode_checkbox">Mobile Mode:</label>
            <input type="checkbox" id="mobile_mode_checkbox" ${useMobileMode ? 'checked' : ''} style="margin-left: 5px;">
          </div>
        </div>
        <div id="snapshot_range_warning" style="margin-top: 6px; min-height: 1.2em; font-size: 0.85em; color: #e0a341; text-align: center;"></div>
        <div class="flex-container" style="margin-top: 10px; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center;">
            <label for="anonymize_user_checkbox">Anonymize User:</label>
            <input type="checkbox" id="anonymize_user_checkbox" style="margin-left: 5px;">
            <i class="fa-solid fa-circle-exclamation" title="Anonymizes the profile picture, profile name, and any mentions of {{user}} in the chatlog." style="margin-left: 5px; cursor: help;"></i>
          </div>
          <hr style="border: none; border-left: 1px solid #ccc; height: 20px; margin: 0 10px;">
          <div style="display: flex; align-items: center;">
            <label for="anonymize_stylesheet_checkbox">Anonymize Styling:</label>
            <input type="checkbox" id="anonymize_stylesheet_checkbox" style="margin-left: 5px;">
            <i class="fa-solid fa-circle-exclamation" title="Applies a default stylesheet to the snapshot, overriding user settings." style="margin-left: 5px; cursor: help;"></i>
          </div>
        </div>
        <div class="flex-container" style="margin-top: 10px; justify-content: center; align-items: center;">
          <div style="display: flex; align-items: center;">
            <label for="show_reasoning_checkbox">Reasoning Expanded:</label>
            <input type="checkbox" id="show_reasoning_checkbox" style="margin-left: 5px;">
            <i class="fa-solid fa-circle-exclamation" title="If checked, reasoning blocks are forced open and included in the snapshot. If unchecked, reasoning blocks are omitted entirely." style="margin-left: 5px; cursor: help;"></i>
          </div>
        </div>
      </div>
    </div>
  `;

    const dialog = $(html);
    dialog.find('#snapshot_regular_button').on('click', () => {
        const messageRange = dialog.find('#message_range_input').val();
        const anonymizeUser = dialog.find('#anonymize_user_checkbox').is(':checked');
        const anonymizeStylesheet = dialog.find('#anonymize_stylesheet_checkbox').is(':checked');
        const showReasoning = dialog.find('#show_reasoning_checkbox').is(':checked');
        captureChatLog('regular', messageRange, anonymizeUser, anonymizeStylesheet, showReasoning);
    });
    dialog.find('#snapshot_grid_button').on('click', () => {
        const messageRange = dialog.find('#message_range_input').val();
        const anonymizeUser = dialog.find('#anonymize_user_checkbox').is(':checked');
        const anonymizeStylesheet = dialog.find('#anonymize_stylesheet_checkbox').is(':checked');
        const showReasoning = dialog.find('#show_reasoning_checkbox').is(':checked');
        captureChatLog('grid', messageRange, anonymizeUser, anonymizeStylesheet, showReasoning);
    });
    dialog.find('#mobile_mode_checkbox').on('change', function() {
        useMobileMode = this.checked;
    });

    // Snapshot what's currently loaded so we can warn about out-of-range
    // requests before the user takes the screenshot.
    const loadedMesids = Array.from(document.querySelectorAll('#chat .mes'))
        .map(el => Number.parseInt(el.getAttribute('mesid'), 10))
        .filter(n => !Number.isNaN(n));
    const loadedMin = loadedMesids.length ? Math.min(...loadedMesids) : null;
    const loadedMax = loadedMesids.length ? Math.max(...loadedMesids) : null;

    const updateRangeWarning = () => {
        const warningEl = dialog.find('#snapshot_range_warning');
        const raw = String(dialog.find('#message_range_input').val() ?? '').trim();
        if (!raw) { warningEl.text(''); return; }
        if (loadedMin === null) {
            warningEl.text('No messages loaded.');
            return;
        }

        let reqStart, reqEnd;
        if (/^\d+$/.test(raw)) {
            reqStart = reqEnd = Number.parseInt(raw, 10);
        } else if (/^\d+-\d+$/.test(raw)) {
            [reqStart, reqEnd] = raw.split('-').map(s => Number.parseInt(s, 10));
        } else {
            warningEl.text(`Invalid range format. Use "N" or "N-M".`);
            return;
        }

        const fullyOutside = reqEnd < loadedMin || reqStart > loadedMax;
        const partiallyOutside = reqStart < loadedMin || reqEnd > loadedMax;
        if (fullyOutside) {
            warningEl.text(`Range ${reqStart}–${reqEnd} is fully outside loaded mesids ${loadedMin}–${loadedMax}. Capture will be empty. Scroll up and click "Show more messages" to load older messages.`);
        } else if (partiallyOutside) {
            const capStart = Math.max(reqStart, loadedMin);
            const capEnd = Math.min(reqEnd, loadedMax);
            warningEl.text(`Only mesids ${capStart}–${capEnd} of requested ${reqStart}–${reqEnd} are loaded. Scroll up and click "Show more messages" to include older ones.`);
        } else {
            warningEl.text('');
        }
    };
    dialog.find('#message_range_input').on('input', updateRangeWarning);

    $('#dialogue_popup').addClass('wide_dialogue_popup');
    callPopup(dialog, 'text', '', { wide: false, large: false, okButton: 'Finish' });
}

function addCaptureButton() {
    const snapshotButtonHtml = `
    <div id="snapshot_extension" class="list-group-item flex-container flexGap5" title="Take a snapshot of the chat log.">
        <div class="fa-solid fa-camera extensionsMenuExtensionButton"></div>
        <span>Snapshot</span>
    </div>`;

    $("#extensionsMenu").append(snapshotButtonHtml);

    const snapshotButton = $('#snapshot_extension');
    snapshotButton.on('click', openSnapshotMenu);
}

jQuery(function () {
    addCaptureButton();
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'snapshot',
        callback: (namedArgs, unnamedArgs) => {
            const format = namedArgs.format ?? 'regular';
            const messageRange = namedArgs.range ?? null;
            const anonymizeUser = namedArgs.anonymize === 'on' || namedArgs.anonymize === 'true';
            const anonymizeStylesheet = namedArgs.anonymizeStylesheet === 'on' || namedArgs.anonymizeStylesheet === 'true';
            const showReasoning = namedArgs.reasoning === 'on' || namedArgs.reasoning === 'true';
            captureChatLog(format, messageRange, anonymizeUser, anonymizeStylesheet, showReasoning);
        },
        aliases: ['snapshot'],
        returns: 'nothing (captures an image of the chat log)',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'format',
                description: 'the format of the snapshot',
                typeList: ARGUMENT_TYPE.STRING,
                defaultValue: 'regular',
                enumList: ['regular', 'grid'],
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'range',
                description: 'the range of messages to include (e.g., "1-10")',
                typeList: ARGUMENT_TYPE.STRING,
                defaultValue: null,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'anonymize',
                description: 'whether to anonymize user data',
                typeList: ARGUMENT_TYPE.BOOLEAN,
                defaultValue: 'false',
                enumList: ['true', 'false'],
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'anonymizeStylesheet',
                description: 'whether to apply a default stylesheet',
                typeList: ARGUMENT_TYPE.BOOLEAN,
                defaultValue: 'false',
                enumList: ['true', 'false'],
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'reasoning',
                description: 'whether to include reasoning blocks (forced expanded)',
                typeList: ARGUMENT_TYPE.BOOLEAN,
                defaultValue: 'false',
                enumList: ['true', 'false'],
            }),
        ],
        unnamedArgumentList: [],
        helpString: `
            <div>
                Captures an image of the chat log.
            </div>
            <div>
                <strong>Example:</strong>
                <ul>
                    <li>
                        <pre><code class="language-stscript">/snapshot</code></pre>
                        captures the entire chat log in regular format
                    </li>
                    <li>
                        <pre><code class="language-stscript">/snapshot format=grid range=1-10 anonymize=on anonymizeStylesheet=on</code></pre>
                        captures messages 1-10 in grid format with user data anonymized and default stylesheet applied
                    </li>
                </ul>
            </div>
        `,
    }));
});
