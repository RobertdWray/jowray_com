System design

# Memorial Memories Site

A place for family and friends to leave voice, video, photo and text memories by phone, text message or the web. Phase 1 only collects. Later phases transcribe and analyze what was collected, then show it back as a tag cloud, a timeline and search.

Roadmap

## Three phases

Phase 1 · now

### Collect

- Web upload: voice, video, photo
- Phone line: leave a voice message
- SMS: text a photo or message, an agent asks follow-ups
- Capture who, approximate date, consent
- Store originals untouched; send a claim link

Phase 2

### Analyze and show

- ElevenLabs transcribes voice and video
- Gemini describes photos and video frames
- Tags, embeddings, search index
- Tag cloud, timeline, search, gallery

Phase 3

### Manage

- Auth.js login (magic link) matched to contributors by verified email or phone
- Contributors edit or add to their own memories
- Family admins approve, hide, tag, merge people
- Can be pulled into phase 2 if moderation is needed sooner

Phase 1

## Collecting memories

Three ways in. Each ends in the same place: the original file in object storage, and a memory record with who left it, roughly when it happened, and what they agreed to.

```
flowchart TB
    subgraph CONTRIB["Contributor"]
        Phone["📞 Calls the memorial number"]
        SMS["💬 Texts a photo or a message"]
        Web["🌐 Opens the website"]
    end

    subgraph INTAKE["Intake"]
        IVR["Voice line (VoIP.ms DID)voicemail records the messagegreeting prompts for name and date"]
        Agent["SMS agentNext.js webhook + Geminiasks: who is in it, when was it,what is your name"]
        Form["Upload formvoice · video · photorecord audio in browser"]
    end

    subgraph CAPTURE["Captured with every memory"]
        Who["Who left itname · phone · emailrelationship"]
        When["Approximate dateas given, plus parsedyear and month"]
        Consent["Consent and visibilitypublic / family / privatecontact opt-in"]
    end

    subgraph SAVE["Saved as-is"]
        Store["Object storageoriginals · checksum · EXIF"]
        DB[("Neon Postgresmemorial · contributor · memorymedia · call · smsanalysis_status = not_started")]
        Claim["Claim link by text or emailso they can edit or add more"]
    end

    Phone --> IVR
    SMS --> Agent
    Web --> Form

    IVR --> Who
    IVR --> When
    IVR --> Consent
    IVR --> Store
    Agent --> Who
    Agent --> When
    Agent --> Consent
    Agent --> Store
    Form --> Who
    Form --> When
    Form --> Consent
    Form --> Store

    Store --> DB
    Who --> DB
    When --> DB
    Consent --> DB
    DB --> Claim
    DB -.->|"phase 2 reads from here"| Later["Phase 2 pipeline"]
```

Phase 1 · SMS path

## How a text message becomes a memory

The agent only asks for what is missing. Gemini reads the text and looks at the photo to decide which questions are still needed, and the whole conversation is kept so nothing the person said is lost.

```
sequenceDiagram
    actor C as Contributor
    participant T as VoIP.ms (SMS/MMS)
    participant N as Next.js webhook
    participant G as Gemini
    participant S as Object storage
    participant DB as Neon

    C->>T: Photo + "Grandpa at the lake, early 80s"
    T->>N: SMS/MMS URL callback (GET: id, from, to, message, media)
    N->>S: Save original photo + checksum
    N->>DB: Find or create SMS_CONVERSATION by phonecreate MEMORY (status pending) + MEDIA + SMS_MESSAGE
    N->>G: Parse text, look at photo:what do we know, what is missing?
    G-->>N: approx_date "early 1980s", place "lake"missing: contributor name, who else is pictured
    N->>T: sendSMS: "Thank you. Who else is in this photo, and what is your name?"
    T->>C: SMS
    C->>T: "That is my mom and me. I'm his nephew, Sam."
    T->>N: SMS URL callback
    N->>G: Parse reply against the open memory
    G-->>N: contributor name, relationship,people mentioned
    N->>DB: Update CONTRIBUTOR, MEMORY,PERSON mentions, SMS_MESSAGE
    N->>T: sendSMS: "Saved. Text another anytime, or edit this one: (claim link)"
    T->>C: SMS
```

Rules for the agent: at most two questions per reply, stop asking after three rounds and save what it has, and never ask for anything already in the database for that phone number.

Data model · phase 1

## Tables written at collection time

MEMORIAL on everything so a second memorial is trivial. USER exists now so phase 3 login matches to contributors by verified email or phone. PERSON is seeded with the person being remembered and grows as people are mentioned. Nothing is hard-deleted; MEMORY_REVISION keeps every edit.

```
erDiagram
    MEMORIAL ||--o{ CONTRIBUTOR : has
    MEMORIAL ||--o{ MEMORY : holds
    MEMORIAL ||--o{ PERSON : "people in this life"
    USER ||--o| CONTRIBUTOR : "is, once logged in"
    CONTRIBUTOR ||--o{ MEMORY : leaves
    MEMORY ||--|{ MEDIA : has
    MEMORY ||--o{ MEMORY_REVISION : "edit history"
    CALL ||--o| MEMORY : produced
    SMS_CONVERSATION ||--o{ SMS_MESSAGE : has
    SMS_CONVERSATION ||--o{ MEMORY : produced
    CONTRIBUTOR ||--o{ CALL : "placed"
    CONTRIBUTOR ||--o{ SMS_CONVERSATION : "had"

    MEMORIAL {
        uuid id PK
        string name "who is being remembered"
        string slug
        date born
        date died
        enum default_visibility "public | family | private"
        datetime created_at
    }
    USER {
        uuid id PK
        string email "verified, nullable"
        string phone "verified, nullable"
        enum role "family_admin | contributor"
        datetime created_at
    }
    CONTRIBUTOR {
        uuid id PK
        uuid memorial_id FK
        uuid user_id FK "nullable until phase 3"
        string name
        string phone
        string email
        string relationship "friend, cousin, coworker"
        bool contact_opt_in
        datetime created_at
    }
    MEMORY {
        uuid id PK
        uuid memorial_id FK
        uuid contributor_id FK
        enum type "voice | video | photo | text"
        enum source "phone_call | sms | web_upload"
        string approx_date_text "as given: Summer 1998"
        int approx_year "parsed, nullable"
        int approx_month "parsed, nullable"
        string place "optional"
        text contributor_note "caption or message"
        string language "default en"
        enum visibility "public | family | private"
        string consent_version
        datetime consented_at
        enum status "pending | approved | hidden"
        enum analysis_status "not_started | queued | done | failed"
        string claim_token "secret edit link"
        datetime created_at
        datetime updated_at
        datetime deleted_at "soft delete"
    }
    MEDIA {
        uuid id PK
        uuid memory_id FK
        string storage_key "original, never overwritten"
        string original_filename
        string checksum_sha256 "dedupe"
        string mime_type
        int size_bytes
        int duration_seconds
        int width
        int height
        datetime captured_at "from EXIF, nullable"
        json exif "raw metadata as received"
        datetime created_at
    }
    PERSON {
        uuid id PK
        uuid memorial_id FK
        string name
        string relationship_to_deceased
        bool is_the_deceased
        datetime created_at
    }
    MEMORY_REVISION {
        uuid id PK
        uuid memory_id FK
        uuid changed_by_user_id FK "nullable"
        enum changed_via "web | sms | claim_link | admin"
        json before
        json after
        datetime created_at
    }
    CALL {
        uuid id PK
        uuid memorial_id FK
        uuid contributor_id FK "nullable until reconciled"
        string provider_call_id
        string from_number
        int duration_seconds
        string recording_url
        json raw_payload
        datetime created_at
    }
    SMS_CONVERSATION {
        uuid id PK
        uuid memorial_id FK
        uuid contributor_id FK "nullable until name known"
        string phone
        enum state "open | awaiting_reply | closed"
        uuid current_memory_id "memory being filled in"
        int questions_asked
        datetime last_message_at
    }
    SMS_MESSAGE {
        uuid id PK
        uuid conversation_id FK
        enum direction "inbound | outbound"
        string provider_message_id
        text body
        json media_urls
        json parsed "what Gemini extracted"
        datetime created_at
    }
```

Data model · phase 2

## Tables added by analysis

These reference the phase 1 tables and never change them. ANALYSIS is one row per media file per model run, so a better model later keeps both results. The tag cloud is a count of MEMORY_TAG per TAG over approved memories; search hits SEARCH_INDEX for keywords and ANALYSIS.embedding for questions like "memories about fishing."

```
erDiagram
    MEDIA ||--o{ ANALYSIS : "analyzed by"
    MEDIA ||--o{ DERIVED_MEDIA : "thumbnails, transcodes"
    MEMORY ||--o{ MEMORY_TAG : has
    TAG ||--o{ MEMORY_TAG : "applied as"
    MEMORY ||--o{ MEMORY_PERSON : features
    PERSON ||--o{ MEMORY_PERSON : "appears in"
    MEMORY ||--o| SEARCH_INDEX : indexed

    ANALYSIS {
        uuid id PK
        uuid media_id FK
        enum kind "transcript | image_description | video_description"
        string provider "elevenlabs | gemini"
        string model
        text text_output "transcript or description"
        json structured "people, places, objects, mood, era clues"
        float confidence
        vector embedding "pgvector"
        datetime created_at
    }
    DERIVED_MEDIA {
        uuid id PK
        uuid media_id FK
        enum kind "thumbnail | poster | web_audio | web_video"
        string storage_key
        string mime_type
        int width
        int height
    }
    TAG {
        uuid id PK
        uuid memorial_id FK
        string label
        string slug
        enum origin "ai | family"
        uuid merged_into_tag_id "nullable, for cleanup"
    }
    MEMORY_TAG {
        uuid memory_id FK
        uuid tag_id FK
        float weight
        enum source "transcript | image | contributor | admin"
    }
    MEMORY_PERSON {
        uuid memory_id FK
        uuid person_id FK
        enum how "mentioned | pictured | contributor"
        float confidence
        bool confirmed_by_family
    }
    SEARCH_INDEX {
        uuid memory_id FK
        tsvector document "note + transcript + descriptions + tags + people"
        datetime built_at
    }
```

Phase 2

## Analyze, then show

A scheduled job picks up every memory with analysis_status = not_started, sends audio to ElevenLabs and images to Gemini, and writes the results into the phase 2 tables. The site reads only from those.

```
flowchart LR
    DB[("Neonanalysis_status =not_started")]

    subgraph PIPE["Analysis job (Vercel Cron)"]
        Pick["Pick next memory"]
        STT["ElevenLabs STTvoice + video audio"]
        Vision["Gemini visionphotos + video framespeople · places · objectsmood · era clues"]
        Extract["Gemini tag extractionfrom transcript +description"]
        Embed["Gemini embeddings"]
        Index["Build search index"]
    end

    subgraph OUT["Written back"]
        A[("ANALYSIS")]
        T[("TAG / MEMORY_TAGMEMORY_PERSON")]
        S[("SEARCH_INDEX")]
    end

    subgraph VIEWS["Memorial site"]
        Cloud["☁️ Tag cloud"]
        Search["🔍 Searchkeyword + semantic"]
        Timeline["📅 Timelineby approximate date"]
        People["👥 By person"]
        Gallery["Memory gallery"]
        Detail["Single memorymedia · transcript · who · when"]
    end

    DB --> Pick
    Pick -->|voice / video| STT
    Pick -->|photo / video| Vision
    STT --> A
    Vision --> A
    A --> Extract --> T
    A --> Embed --> A
    A --> Index
    T --> Index
    Index --> S

    T --> Cloud
    T --> People
    S --> Search
    DB --> Timeline
    Cloud --> Gallery
    Search --> Gallery
    Timeline --> Gallery
    People --> Gallery
    Gallery --> Detail
```

Tech stack

## What runs where

```
flowchart LR
    subgraph CHANNELS["Channels"]
        Browser["Browserupload form · memorial site"]
        VoIPms["SMS + voice providerVoIP.ms · DID_JOWRAY"]
    end

    subgraph VERCEL["Vercel"]
        Next["Next.js apppages · upload APIVoIP.ms SMS callback · voicemail fetchclaim links"]
        Cron["Vercel Cronphase 2 analysis job"]
        Auth["Auth.js (NextAuth)phase 3: magic-link loginfamily content management"]
    end

    subgraph DATA["Data"]
        Neon[("Neon Postgrespgvector · tsvector")]
        Blob["Object storageoriginals + derived files(Vercel Blob or Neon storage)"]
    end

    subgraph AI["AI services"]
        Gemini["Google Gemini APIimage · video · textSMS parsing · tags · embeddings"]
        Eleven["ElevenLabsspeech-to-text"]
    end

    Sentry["Sentryerrors · performancewebhook failures"]

    Browser --> Next
    VoIPms -->|"SMS/MMS URL callback"| Next
    Next -->|"API: sendSMS / sendMMS,fetch voicemail files"| VoIPms
    Next --> Neon
    Next --> Blob
    Next -->|"phase 1: SMS agent"| Gemini
    Cron --> Neon
    Cron --> Blob
    Cron --> Gemini
    Cron --> Eleven
    Auth -.-> Next
    Next -.-> Sentry
    Cron -.-> Sentry
```

Next.js on Vercel

App Router, route handlers for the upload API and the VoIP.ms SMS/MMS callback, server actions for the forms.

VoIP.ms

The memorial number is a VoIP.ms DID (`DID_JOWRAY`).
- **Texts and photos:** these arrive through the DID's SMS/MMS URL callback. It's a GET request to our route handler carrying `{ID}`, `{TIMESTAMP}`, `{FROM}`, `{TO}`, `{MESSAGE}`, and `{MEDIA}` (a comma-separated list of media files).
- **Retries:** with URL Callback Retry on, VoIP.ms expects the response body `ok`. Otherwise it resends the same message every 30 minutes, so the handler must be idempotent on the message ID.
- **Replies:** these go out through the API (`sendSMS`, `sendMMS`).
- **Voice messages:** these land in VoIP.ms voicemail. The app fetches them through the API (`getVoicemailMessages`, `getVoicemailMessageFile`), or they arrive as voicemail-to-email attachments. Either way, the original audio is copied into object storage.
- **Open question:** the account's API access is set up with an IP whitelist (`voipms_whitelisted_ip`), so API calls from Vercel functions need a stable egress IP or a relay. Resolve this before building the SMS agent.

Neon Postgres

All tables above. Enable pgvector for ANALYSIS.embedding and use a tsvector column for SEARCH_INDEX. Branch the database per preview deploy.

Object storage

Originals are write-once; derived files live under a separate prefix. Keep the storage key in MEDIA, never a public URL.

Google Gemini

Phase 1: parse SMS text and photos to drive the agent's questions. Phase 2: image and video description, tag extraction, embeddings.

ElevenLabs

Speech-to-text for voice messages and video audio tracks. Store the raw transcript with timestamps in ANALYSIS.structured.

Sentry

Errors and performance for the app and the cron job. Alert on any failed SMS/MMS callback or voicemail fetch, since a lost text or call is a lost memory.

Auth.js

Phase 3. Magic-link sign-in by email or SMS; link USER to CONTRIBUTOR by the verified email or phone. Until then, claim links give contributors edit access.