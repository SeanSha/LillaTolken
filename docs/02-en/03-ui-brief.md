# 03 UI brief

Series: [01 System design](01-system-design.md) · [02 Developer guide](02-developer-guide.md) · **03 UI brief** · [04 Tab5 feasibility](04-tab5-feasibility.md) · [05 Code guide](05-code-guide.md) · [06 Research prompts](06-research-prompts.md)

The Chinese file is in [`docs/01-zh`](../01-zh/03-界面设计需求.md).

For an external UI or design tool. Paste this whole note in as the product background, the screen list, and the constraints. After the design is settled, hand it to development (see Deliverables).

## 1. Product

- Name: 小翻译 · Lilla Tolken. A **push-to-talk Chinese ↔ Swedish translator for preschool children (about 3–6)**, running in iPhone Safari, portrait.
- Who uses it: the child presses the buttons and **cannot read**. An adult beside them reads the text and handles problems.
- Feeling: warm, safe, playful, not frightening. One thing at a time. One screen has one or two primary buttons.
- Two directions: 🇨🇳→🇸🇪 (speak Chinese, hear Swedish) and 🇸🇪→🇨🇳.
- Flow (each step is a screen; see section 3): press to speak → listen → think → (one short question if needed) → **confirm the meaning (✅/❌)** → translate → play the sound.

## 2. Hard constraints

- **Artboards:** produce both **390×844 (iPhone 14)** and **375×667 (iPhone SE; about 553 px of height once the Safari toolbar is in)**. Narrowest width is 320. Content must **not overflow sideways**. Vertical scrolling is allowed when the height is short, but the **primary button must stay visible and must not be clipped**.
- Safe areas: leave room for the notch and the Home indicator (about 34 px).
- **Touch targets** ≥ 64 pt. Primary buttons ≥ 96 pt. Gap between buttons ≥ 12 pt. Put the main action in the **lower half** of the screen.
- **Icons, color, and motion come before text.** No function may depend on reading. Text is for the adult. Both Chinese and Swedish must fit. Swedish words are longer.
- Type: iOS system fonts only (SF Pro Rounded / PingFang SC). Any other font must be free for commercial use, include Simplified Chinese, and name its source.
- Contrast: text against background ≥ 4.5:1. Do not use color alone to tell states apart. Pair it with an icon or a shape.
- No dark mode. No login, no menu, no deep navigation.
- Motion is simple CSS only: scale, pulse, sway, a progress ring. No video and no large Lottie files.
- Supply illustrations and icons as **SVG** (or transparent PNG @3x). Keep each file small. No photographs of real children.
- **Do not show the child's recognized words** on the child's screen. Adult information stays folded under "👁 For adults".

## 3. Screens

Every screen below must be designed, including its states. The tappable elements are fixed by the state machine. Appearance and layout may change. **Do not add or remove a function.**

| # | Screen | When | Main elements / states |
|---|---|---|---|
| 0 | Top bar (every screen) | Always | Left: cancel (only during a task). Center: title or direction flags. Right: switch direction ⇄ (during a task) and adult settings ⚙ (quiet) |
| 1 | **Home** | Idle | Two very large buttons: 🇨🇳🎤➜🇸🇪 / 🇸🇪🎤➜🇨🇳. A mascot is allowed. An adult warning may appear at the bottom (HTTPS required / recording unsupported) |
| 2 | **Recording** | After press | Three states: ① prompt playing ("现在可以说啦") ② **listening**: a 30-second ring, a large number, a large Stop. The last 5 seconds turn warning-colored ③ working (grey, disabled). Small dots show which segment (at most 3). A small "clarify ❓ / correct ✏️" mark is allowed |
| 3 | **Continue or finished** | After one segment | Dots for segments already recorded. Two buttons: 🎤➕ continue / ✅ finished |
| 4 | **Busy** | Waiting on AI | Four stages: listen / understand / translate / prepare the voice. A small moving character plus a short line for the adult |
| 5 | **One question** | A clarification is needed | Play one short question. A large 🔊 replay. A very large 🎤 answer. The question text is small, for the adult |
| 6 | **Confirm the meaning** | Required before translation | First play "你的意思是…?". 🔊 replay. Two very large buttons, **✅ yes / ❌ no** (green / red, not color alone) |
| 7 | **Result** | Translation is done | States: ① preparing (🔊 Play pulses) ② speech failed (retry / text only) ③ delivered (replay + ➕ new turn + 🎤🔁 record again). Adult card: source + translation. Long lines wrap |
| 8 | **Switch direction** | ⇄ was pressed | 🔄 plus the target flags. Two buttons: switch / keep going |
| 9 | **Error** | Network, microphone, or model failed | ⚠️ plus a large retry and cancel. Adult text names the cause (permission, network, timeout, not configured) |
| 10 | **Cannot finish** | 3 questions, 2 corrections, or repeated empty hearings | 🤷 plus start over and cancel. Adult text explains |
| 11 | **Didn't hear** | Recognition was empty | 👂❓ plus a large "say it again". Remaining tries are for the adult |

The adult developer panel behind ⚙ does not need a new design. Leave it as it is.

## 4. Current visual language

This may be kept or replaced.

- Warm cream background `#FFF7E6`. Main colors: red `#EF4444` (start/stop), blue `#3B82F6`, green `#22C55E` (confirm), orange `#F59E0B` (retry), purple `#8B5CF6` (play), grey `#94A3B8`.
- Large buttons with a 28 px radius and a 6 px bottom shadow that sinks on press.
- The current result is **not good enough**. It looks like an adult tool. It lacks a character and a feeling, and the layout is not focused. The new design should feel more childlike without becoming a distraction, and the hierarchy should be clearer.

## 5. What the design tool should return

1. High-fidelity frames for the 12 items above, including their states, at both artboard sizes.
2. One **spec sheet**: color, type scale, spacing, radius, buttons (normal / pressed / disabled / pulse), and shadow.
3. An icon and illustration list, plus the SVG files.
4. Motion notes: which element, what it does, duration, and easing.

## 6. How to hand it to development

1. A **Figma link** with view access, plus a **PNG @2x** of every screen at both sizes. This is the best form.
2. Or exported HTML/CSS/React, together with screenshots. That code is a visual reference only. It will be rewritten with the existing React components. It will not be pasted in.
3. The spec from section 5 may be text, a table, or an image.
4. Assets in an `assets/` folder (SVG/PNG), with a note of where each file is used.

During implementation the state machine, the dialogue rules, every `data-testid`, and the automated tests stay as they are. Only `apps/web/src/ui/*` and the styles change. Each screen is checked at 375×553, 375×667, 390×844, and 320 px wide, with no overflow.
