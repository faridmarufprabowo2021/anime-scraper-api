export interface SearchResult {
  title: string;
  slug: string;
  thumbnailUrl?: string;
  rating?: string;
  type?: string;
  provider: string;
}

export interface EpisodeItem {
  episodeNumber: number;
  slug: string;
  title: string;
}

export interface StreamSource {
  server: string;
  quality: string;
  qualityRank?: number;
  provider: string;
  url: string;
  isIframe?: boolean;
}

export interface DownloadLink {
  host: string;
  url: string;
}

export interface DownloadSource {
  quality: string;
  links: DownloadLink[];
}

export interface EpisodeStreams {
  episodeNumber: number;
  title: string;
  streamSources: StreamSource[];
  downloadSources?: DownloadSource[];
}