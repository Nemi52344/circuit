/* Opening a platform's own composer with the words already in it.

   LinkedIn and X will not let Circuit publish on their behalf — LinkedIn only grants that to
   approved partner apps, and X charges per post. What both do allow is a link that opens their
   composer with text already in the box. So the last step stays a person pressing Post on the
   platform, which is the honest arrangement anyway: those two are the accounts Circuit has no
   permission to speak through.

   Neither will accept a picture this way. There is no parameter for it on either platform and
   there never has been — an image has to be chosen from the device. So the picture is saved to
   the machine at the same moment the composer opens, ready to attach. Pretending otherwise
   would produce posts that quietly went out as plain text. */

export const X_LIMIT = 280;

export type Composer = {
  url: string;
  /* What will not happen, so the page can say so rather than letting the person find out. */
  caveat: string;
  /* Some of these prefills are undocumented and have changed before. Where that is true the
     caption goes to the clipboard as well, so a composer that opens empty costs one paste
     rather than a retyped post. */
  alsoCopy: boolean;
};

export function composerFor(platform: string, caption: string): Composer | null {
  const text = caption.trim();
  if (!text) return null;

  if (platform === "X") {
    /* X's web intent is documented and long-standing: it opens the composer on desktop and the
       app on a phone. The text arrives selected, so it can be replaced in one keystroke. */
    return {
      url: `https://x.com/intent/post?text=${encodeURIComponent(text)}`,
      caveat: text.length > X_LIMIT
        ? `This is ${text.length} characters and X stops at ${X_LIMIT}. Shorten it first or the composer will open with it cut off.`
        : "Attach the picture yourself — X's composer link cannot carry one.",
      alsoCopy: false,
    };
  }

  if (platform === "LinkedIn") {
    /* LinkedIn's prefill is undocumented and has moved around: the feed form only works on
       desktop and sometimes lands in the article editor instead. This endpoint is the more
       reliable of the two, but "more reliable" is not "reliable", so the caption is copied at
       the same time. */
    return {
      url: `https://www.linkedin.com/sharing/compose?text=${encodeURIComponent(text)}`,
      caveat: "LinkedIn's prefill is unofficial and sometimes opens empty — the caption is on your clipboard either way. Attach the picture yourself.",
      alsoCopy: true,
    };
  }

  return null;
}
