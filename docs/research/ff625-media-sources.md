# FF625 media sources

Verified 2026-11-09. Scope: source selection for private English word cards; no deck or application changes.

## Recommended source policy

Use OpenMoji where an icon clearly identifies the intended concept; use original diagrams/context for abstract words. Use a verified Commons US recording when available. Keep CMUdict as pronunciation data, with meaning-specific overrides and manual stress review. If no recording is verified, offer a visibly labelled US text-to-speech fallback. These are implementation recommendations, rather than guarantees supplied by the sources.

## OpenMoji: images and metadata

The [official repository](https://github.com/hfg-gmuend/openmoji#anatomy-of-the-openmoji-repository) documents the central JSON metadata and exported SVG/PNG directories. Pin a release for repeatability: the official [latest release API](https://api.github.com/repos/hfg-gmuend/openmoji/releases/latest) returned **17.0.0** when checked. The repository cautions that `master` is under active development.

| Resource | Working URL |
| --- | --- |
| Pinned JSON index | `https://raw.githubusercontent.com/hfg-gmuend/openmoji/17.0.0/data/openmoji.json` |
| Dog SVG | `https://raw.githubusercontent.com/hfg-gmuend/openmoji/17.0.0/color/svg/1F415.svg` |
| Dog PNG, 618 px | `https://raw.githubusercontent.com/hfg-gmuend/openmoji/17.0.0/color/618x618/1F415.png` |
| Apple SVG, website | `https://openmoji.org/data/color/svg/1F34E.svg` |
| Full color PNG archive | `https://github.com/hfg-gmuend/openmoji/releases/download/17.0.0/openmoji-618x618-color.zip` |

JSON fields include `hexcode`, `annotation`, `tags`, `openmoji_tags`, `openmoji_author`, and `openmoji_date`. In the current index, dog is `1F415` (Sofie Ascherl); red apple is `1F34E` (Liz Bravo). Search annotation/tags to make a candidate mapping, then review visual meaning; an emoji keyword match alone does not validate the card. [Official JSON](https://raw.githubusercontent.com/hfg-gmuend/openmoji/master/data/openmoji.json).

Graphics are **CC BY-SA 4.0**; repository helper code has a different license. Credit OpenMoji, link to the source/license, and identify changes. When distributing adapted graphics, license the adaptation under CC BY-SA 4.0 or another license allowed by the legal code; OpenMoji asks for CC BY-SA 4.0. Format conversion alone does not create adapted material under §2(a)(4). Keep attribution for the rasterized copy, and describe actual edits such as cropping, labels or recoloring. [OpenMoji FAQ](https://github.com/hfg-gmuend/openmoji/blob/master/FAQ.md#licensing-and-attribution), [license terms §§2–3](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en).

Suggested card/media credit: `Image: OpenMoji / [individual author], CC BY-SA 4.0. Source: [asset URL]. Changes: converted SVG to PNG; [other edits, if any].` Keep a linked source and license in the card's credits/export manifest, not only in a build script. The project's [attribution guidance](https://github.com/hfg-gmuend/openmoji#attribution-requirements) allows sensible placement such as an About section/footer.

## CMUdict: US pronunciation data

Use the [official CMU US English dictionary](https://github.com/cmusphinx/cmudict), not a scraped dictionary website:

- Dictionary: `https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict`
- Phone classes: `https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.phones`
- Valid stressed symbols: `https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.symbols`
- License: `https://raw.githubusercontent.com/cmusphinx/cmudict/master/LICENSE`
- For a reproducible snapshot, resolve `https://api.github.com/repos/cmusphinx/cmudict/commits/master` and replace `master` with its returned `sha` in these raw URLs. Verified snapshot: `74790861f652b15e4ac49015a90074ad62a27690`.

The current raw file uses lowercase entry names, space-separated ARPABET tokens and alternate entries such as `wind(2)`. Vowel digits mean `0` unstressed, `1` primary stress, `2` secondary stress. Preserve alternates; variant numbers are not meanings, frequencies or quality rankings. The [official format documentation](https://github.com/cmusphinx/cmudict-tools#cmu-pronunciation-dictionary-file-format) explains the formats/stress. CMUdict itself warns that errors/omissions remain. Its [LICENSE](https://github.com/cmusphinx/cmudict/blob/master/LICENSE) permits modification/redistribution and requires retaining the copyright, conditions and disclaimer; include that complete license with redistributed data/derived pronunciation tables.

Verified raw entries illustrate why first-entry selection is unsafe:

| Word | Raw alternatives | Required review |
| --- | --- | --- |
| wind | `W AY1 N D`; `W IH1 N D` | turn/wind up vs moving air |
| tear | `T EH1 R`; `T IH1 R` | rip vs eye fluid |
| close | `K L OW1 S`; `K L OW1 Z` | near vs shut |
| contract | `K AA1 N T R AE2 K T`; `K AH0 N T R AE1 K T` | noun vs verb stress |

Source: [current dictionary](https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict). An ARPABET-to-IPA mapping is broad transcription, not measured articulation: account for unstressed `AH0 → ə`, `ER0 → ɚ` versus stressed `ER → ɝ`, dictionary conventions such as `EH → ɛ` versus Cambridge `/e/`, and whether vowel length marks are used. CMUdict supplies no syllable boundaries in those entries, so directly placing `ˈ` before a stressed vowel can put the IPA stress mark in the wrong place; review multisyllabic words separately. This is an implementation inference from the data format and [IPA suprasegmental conventions](https://www.internationalphoneticassociation.org/content/ipa-chart). The maintained [cmudict-tools US phone table](https://github.com/cmusphinx/cmudict-tools/blob/master/accents/en-US.csv) is a reference, but is **GPL-3.0-or-later**, a different license from CMUdict; do not silently copy that table/code under CMUdict's license.

## Commons: verified recordings, metadata and MP3

Known `File:En-us-<word>.ogg` titles can be queried together. Use returned file URLs; do not construct upload hash paths. The [Imageinfo API](https://www.mediawiki.org/wiki/API:Imageinfo) exposes `url` and HTML-formatted `extmetadata`. [TimedMediaHandler videoinfo](https://www.mediawiki.org/wiki/Extension:TimedMediaHandler/API) additionally exposes `derivatives` for audio/video. `imageinfo` and `videoinfo` cannot be requested together; choose `videoinfo` for this task.

```sh
curl --fail --get 'https://commons.wikimedia.org/w/api.php' \
  -A 'SayMore source preparation (personal educational project)' \
  --data-urlencode 'action=query' \
  --data-urlencode 'format=json' \
  --data-urlencode 'formatversion=2' \
  --data-urlencode 'redirects=1' \
  --data-urlencode 'titles=File:En-us-dog.ogg|File:En-us-apple.ogg' \
  --data-urlencode 'prop=videoinfo' \
  --data-urlencode 'viprop=url|extmetadata|derivatives'
```

For each `query.pages[]`, reject `missing`; inspect `videoinfo[0]`. Select `derivatives[]` where `type === 'audio/mpeg'` / `transcodekey === 'mp3'`; some files may have no MP3 derivative. Save `descriptionurl`, `url`, chosen derivative URL, and `extmetadata` values `Artist`, `Credit`, `LicenseShortName`, `LicenseUrl`, `AttributionRequired`, `UsageTerms`, `Restrictions`. Treat HTML as untrusted input: render safe text/allowed links rather than injecting it. Metadata requests are expensive; use small batches, cache results, and honor API continuation. Browser cross-origin requests can add `origin=*` for public unauthenticated reads. [API documentation](https://www.mediawiki.org/wiki/API:Imageinfo).

Verified examples (API response and direct MP3 fetch):

| File page | Returned MP3 | Author / selected license |
| --- | --- | --- |
| [dog](https://commons.wikimedia.org/wiki/File:En-us-dog.ogg) | `https://upload.wikimedia.org/wikipedia/commons/transcoded/0/06/En-us-dog.ogg/En-us-dog.ogg.mp3` | Dvortygirl / CC BY-SA 3.0 |
| [apple](https://commons.wikimedia.org/wiki/File:En-us-apple.ogg) | `https://upload.wikimedia.org/wikipedia/commons/transcoded/9/9a/En-us-apple.ogg/En-us-apple.ogg.mp3` | Dvortygirl / CC BY-SA 3.0 |

`En-us-cat.ogg` also resolved with a returned MP3 and the same author/license. Record per-file licensing; Commons does not apply one blanket media license. A suitable credit is `Audio: Dvortygirl, “En-us-dog”, Wikimedia Commons, CC BY-SA 3.0; MP3 transcode, no editorial changes`, with file-page and license links. Inspect description/category and listen before declaring US accent, correct meaning and usable quality verified; the filename alone is not sufficient. [Commons reuse guidance](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia/en).

## Browser speech fallback

Yes: provide a button labelled **기기 합성 음성 · 미국식** instead of presenting it as a recorded reference. Feature-detect `speechSynthesis`; call `getVoices()` and also handle `voiceschanged` because the list may initially be empty. Select an available voice with `lang` equivalent to `en-US` and set both `utterance.voice` and `utterance.lang = 'en-US'`. If unavailable, show that US synthesis is unavailable rather than silently using another accent. Start from a user click, handle synthesis errors, and avoid stacking queued utterances. [Web Speech API §§4.2.2–4.2.8](https://webaudio.github.io/web-speech-api/#speechsynthesis).

Voice inventory is browser/device dependent; a voice may be local or remote. The API does not promise consistent quality, offline operation, homograph sense, or a downloadable/licensed audio file. Use synthesis for listening convenience; do not export generated recordings on the assumption that the API grants redistribution rights. For ambiguous words, use a short sense-specific phrase and verify that voice's output. This is a product recommendation based on the [API's voice selection and service semantics](https://webaudio.github.io/web-speech-api/#speechsynthesisvoice).
