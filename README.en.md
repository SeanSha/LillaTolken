[中文](README.md) | **English**

# 小翻译 · Lilla Tolken

A push-to-talk translator between **Chinese and Swedish**, made for preschool children. A child presses a large button, speaks, and hears the other language. An adult nearby can read the text and help when something was not understood.

This is an **adult feasibility prototype**. It is for trying the conversation flow and the speech pipeline. It is not a study with children, and it does not use real children's voices.

## The screens

One thing at a time. The main buttons sit in the lower half of the screen, and icons, color, and sound are enough to use them. Chinese and Swedish are shown together, mainly for the adult nearby.

These frames are the current screens (recaptured from the running app). The spoken ones use built-in synthetic examples, not a real recording. The apple and the cup on the cards are drawings made to show the screen.

**Home**

<table>
  <tr>
    <td align="center" width="33%">
      <img src="docs/screenshots/01-home.png" alt="Home: speak Chinese, speak Swedish, photo vocabulary, and my cards" width="220"><br>
      <b>Choose a direction</b><br>
      Speak Chinese, speak Swedish, or take a photo
    </td>
  </tr>
</table>

**Chinese → Swedish** (synthetic example 「我想去厕所」; unclear meaning adds one short question)

<table>
  <tr>
    <td align="center" width="33%">
      <img src="docs/screenshots/zh-sv/02-listening.png" alt="Chinese→Swedish: listening" width="220"><br>
      <b>I'm listening</b>
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/zh-sv/03-continue.png" alt="Chinese→Swedish: continue or finish" width="220"><br>
      <b>Anything more?</b>
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/zh-sv/04-question.png" alt="Chinese→Swedish: one small question" width="220"><br>
      <b>One small question</b>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/zh-sv/05-confirm.png" alt="Chinese→Swedish: confirm meaning" width="220"><br>
      <b>Confirm first</b>
    </td>
    <td align="center">
      <img src="docs/screenshots/zh-sv/06-result.png" alt="Chinese→Swedish: translation result" width="220"><br>
      <b>Say it aloud</b>
    </td>
  </tr>
</table>

**Swedish → Chinese** (synthetic example 「Lägg boken på bordet.」; no clarification or confirmation)

<table>
  <tr>
    <td align="center" width="33%">
      <img src="docs/screenshots/sv-zh/02-listening.png" alt="Swedish→Chinese: listening with English button labels" width="220"><br>
      <b>I'm listening</b><br>
      Buttons also show English
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/sv-zh/03-continue.png" alt="Swedish→Chinese: continue or finish" width="220"><br>
      <b>Anything more?</b>
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/sv-zh/06-result.png" alt="Swedish→Chinese: Swedish source and Chinese" width="220"><br>
      <b>Chinese result</b><br>
      Source + Chinese together
    </td>
  </tr>
</table>

Photo vocabulary is for an object. After it is named, it goes into the card library, and a tap plays it.

<table>
  <tr>
    <td align="center" width="33%">
      <img src="docs/screenshots/09-preview.png" alt="After the photo, check it and identify the object" width="220"><br>
      <b>Name it</b><br>
      Photograph an object, not a person
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/07-cards.png" alt="My vocabulary cards: categories and two cards" width="220"><br>
      <b>My cards</b><br>
      Grouped by category
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/08-card.png" alt="One card: apple, with Chinese and Swedish played separately" width="220"><br>
      <b>Tap to hear</b><br>
      Chinese and Swedish, separately
    </td>
  </tr>
</table>

## How one conversation goes

The child chooses a direction first. Speaking Chinese for a Swedish listener, and speaking Swedish for a Chinese listener, do not follow the same steps.

**Chinese → Swedish**

1. Press the button and speak. One thought can be split into a few short turns, each up to about 30 seconds.
2. When speaking stops, the app works out the meaning.
3. If the meaning is clear, the child confirms yes or no.
4. If it is not clear, the app asks **one** short question, at most three times. If it is still unclear, the turn stops and can start over. It does not keep asking.
5. Only after a yes does it translate into Swedish and read the result aloud.

**Swedish → Chinese**

Once the speech is understood, it translates directly. The screen shows the original Swedish and the Chinese together, and reads the Chinese aloud. This direction does not ask a follow-up question and does not ask for confirmation.

```mermaid
flowchart TD
  H[Home]
  H -->|Speak Chinese or Swedish| A[Press and speak]
  H -->|Photo vocabulary| P[Photograph one object, not a person]
  H -->|My cards| L[Cards grouped by category]
  A --> B{Is this short turn finished?}
  B -->|Say a bit more| A
  B -->|Finished| C[Understand]
  C -->|Not heard, tries left| A
  C -->|Still not heard| Z[Stop and start over]
  C -->|Chinese, meaning is clear| D{Yes or no?}
  C -->|Chinese, not clear| E[Ask one small question]
  E --> A
  C -->|Still unclear after the questions| Z
  D -->|Yes| F[Swedish text and voice]
  D -->|No, a correction is allowed| A
  D -->|Still no after the corrections| Z
  C -->|Swedish| G[Chinese text and voice]
  P --> V[Name that one object]
  V -->|One object| K[Card: Chinese and Swedish]
  V -->|Several objects| Q[Pick one]
  Q --> K
  V -->|A person, or nothing| P
  K --> L
  L -->|Tap| S[Hear Chinese or Swedish]
```

A wrong or unheard turn can be tried again. When the allowed tries are used up, the turn stops instead of guessing. Changing direction in the middle first asks whether to abandon this turn. The translation can be replayed, or spoken once more in the same direction.

## Photo vocabulary

The home screen also has **Photo Vocabulary** and **My Vocabulary Cards**. Photo Vocabulary opens the camera directly. Photograph an object, not a person. The result is a card with Chinese and Swedish, and a tap plays either one. Cards are grouped into categories such as animals, food, and toys.

A card is stored on this device first. To show the same library on another device in the household, press and hold **家长** on the card page for about two seconds, then pair with a household passphrase of at least 8 characters. That passphrase is not the monitoring password. Deleting a card asks for confirmation first.

In the on-Mac mode, identifying the photo also stays on this computer. Cloud mode and Try it send that one photo to a cloud service, only to name the object. Do not photograph a face or personal information.

## Three ways to run it, one interface

| | What it is for | Where the audio goes |
|---|---|---|
| **Try it** | Walk through the screens with fixed examples, no API key | Stays on this computer |
| **On this Mac** | Speech recognition, understanding, and translation all run locally | Stays on this computer |
| **In the cloud** | Connect a speech service and try real speech | Audio is sent to the cloud, for adult or synthetic speech only |

The same page opens in Safari on a phone. Cloud mode sends recordings off this computer. Do not use it with children, and do not say personal information.

Setup, phone access, the on-Mac engines, and the monitoring panel are in [02 Developer guide](docs/02-开发说明.md) (Chinese).

## What this version cares about

- A child does not need to read. Large buttons and sound are enough.
- Chinese is translated into Swedish only after the meaning is confirmed, so an unclear phrase is not spoken out.
- If it still is not clear, the turn stops instead of asking question after question.
- Records kept for review store only things like timing and success. They do not store audio, what was said, or the translation. A vocabulary card does keep its photo and the two words. That is separate from the monitoring record.
- A photo is only for an object. A face or a full-body picture does not become a card, and no personal name is written.

## Read on

- [01 System design](docs/01-系统设计.md): the full product and technical design
- [02 Developer guide](docs/02-开发说明.md) (Chinese): how to run it, try it on a phone, and open monitoring
- [03 UI design brief](docs/03-界面设计需求.md) (Chinese): screens, buttons, and constraints for a design tool
- [04 Tab5 feasibility](docs/04-Tab5迁移可行性.md) (Chinese): whether this can move onto Tab5 hardware
- [05 Code guide](docs/05-代码导读.md) (Chinese): the architecture, what each file does, and how one turn runs

## License

This repository is under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0). Personal study, research, experiments, and hobby projects are allowed. Schools, charities, and public research organizations may use it under the license as well.

Commercial use is not covered. Using it in a product, a paid service, or a company's business needs separate permission from the author first. The full terms are in [LICENSE](LICENSE).

Required Notice: Copyright 2026 seansha30 (https://github.com/SeanSha/LillaTolken)
