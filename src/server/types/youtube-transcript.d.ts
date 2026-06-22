/**
 * Type declarations for youtube-transcript package.
 * Package may not be installed in some environments — this stub satisfies TS.
 */
declare module "youtube-transcript" {
  export interface TranscriptSegment {
    text: string;
    duration: number;
    offset: number;
  }

  export class YoutubeTranscript {
    static fetchTranscript(videoId: string, options?: { lang?: string }): Promise<TranscriptSegment[]>;
  }
}
