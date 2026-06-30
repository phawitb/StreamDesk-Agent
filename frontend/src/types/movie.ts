export interface Movie {
  title: string;
  url: string;
  slug: string;
  poster: string;
  rating: string;
  quality: string;
  language: string;
}

export interface MoviesResponse {
  page: number;
  total_pages: number;
  count: number;
  movies: Movie[];
}
