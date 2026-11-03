# Photograph an object into a card

Example: on the home screen tap the camera, photograph a cup, tap recognize, see 「杯子 / en kopp」, tap save.

This path does not enter the dialogue machine. The machine stays on the home screen. `App` uses its own `feature` to draw the cards.

How to read this page: the machine JSON, which stays idle, then the card `stage`, then the call sequence, then the four steps.

## The machine at this moment

Taking the photo, recognizing it, and saving it do not change `snap.context.task`.

```json
{
  "value": "idle",
  "context": {
    "sessionId": "session-1",
    "preset": "mock",
    "task": null,
    "lastDelivered": null,
    "pendingDirection": null,
    "safeReturnState": null,
    "activeRequestId": null,
    "error": null,
    "fallbackReason": null,
    "audioStatus": "none",
    "segmentStartedAt": null
  }
}
```

The cup lives in `VocabularyShell`'s `stage`. This is the draft before save. The photo bytes are not listed. The category `home` is illustrative.

```json
{
  "feature": "photo",
  "stage": {
    "name": "draft",
    "cardId": "card-1",
    "draft": {
      "zh": "杯子",
      "sv": "kopp",
      "article": "en",
      "translationUncertain": false,
      "category": "home"
    },
    "banner": null
  }
}
```

## Who calls whom

```mermaid
sequenceDiagram
  participant App as App.tsx
  participant Shell as VocabularyShell.tsx
  participant Img as image.ts
  participant Flow as flow.ts
  participant Id as identity.ts
  participant Lib as library.ts
  participant API as vocabulary/api.ts
  participant SV as app.ts

  App->>App: setOpeningFile, setFeature photo
  App->>Shell: VocabularyShell, entry photo
  Shell->>Img: onFile calls compressImageFile
  Shell->>Flow: onIdentify calls claimRecognition
  alt lock already held
    Flow-->>Shell: blocked
  else start
    Shell->>Lib: findByHash
    alt this photo was saved before
      Lib-->>Shell: open the old card
    else no old card
      Shell->>API: identifyImage
      API->>SV: POST /api/vocabulary/identify
      SV->>SV: assertVocabularyImage
      alt preset local
        SV->>SV: local identify, then normalizeVocabularyModelOutput
      else cloud, and mock identify also uses cloud
        SV->>SV: createVocabularyIdentifier identify, responses.create
      end
      SV-->>Shell: identify result
      Shell->>Flow: stageAfterIdentify calls stepAfterIdentify
    end
    Shell->>Flow: releaseRecognition
  end
  Note over Shell,Lib: later, Save, and this screen is a draft
  Shell->>Id: findVocabularyMatch
  Shell->>Lib: saveNewCard writes IndexedDB
```

`stepAfterIdentify` blocks `person` and `none`. `uncertain` opens an empty draft. `multiple` opens a choice. One candidate opens a draft with both words. Saving requires Chinese and Swedish, then checks for the same word before `saveNewCard`.

Previous: [Not heard, an error, or the limit](05-not-heard-error-or-limit.md) · Next: [Open a card and hear the word](07-open-a-card-and-speak-it.md)
