import { BaseAgent } from './base.js';
import { ContextResponse, TaskEnvelope } from '../types/messages.js';
import { RepositoryContextSearch, RepositorySearchOptions } from '../context/repository-search.js';
import { GitHubContextSearch, GitHubSearchOptions } from '../context/github-search.js';
import { WeatherService } from '../services/weather.js';
import { notifier } from '../telegram/notifier.js';

export interface NamiOptions extends RepositorySearchOptions {
  github?: GitHubSearchOptions;
  weather?: WeatherService;
}

/**
 * Nami - Context Retrieval Agent
 *
 * Aggregates context from all configured sources in parallel:
 *  - Local knowledge directory (always active)
 *  - GitHub code + repo search (when GITHUB_TOKEN + GITHUB_USERNAME are set)
 *
 * Results are merged and ranked by relevance before being passed to specialists.
 */
export class NamiAgent extends BaseAgent {
  private readonly localSearch: RepositoryContextSearch;
  private readonly githubSearch?: GitHubContextSearch;
  private readonly weatherService?: WeatherService;

  constructor(options: NamiOptions = {}) {
    super('nami-primary', 'nami');
    this.localSearch = new RepositoryContextSearch(options);
    if (options.github) {
      this.githubSearch = new GitHubContextSearch(options.github);
    }
    this.weatherService = options.weather;
  }

  protected async doWork(task: TaskEnvelope): Promise<ContextResponse> {
    // Skip context lookup for casual short phrases — they don't need repo context
    // and injecting GitHub summaries into greetings makes Robin sound like a bot
    if (isCasualPhrase(task.userRequest)) {
      this.logger.debug({ taskId: task.taskId }, 'Nami: casual phrase, skipping context search');
      return { taskId: task.taskId, findings: [], summary: '', timestamp: new Date() };
    }

    const sources: string[] = ['local'];
    if (this.githubSearch) sources.push('github');

    this.logger.info({ taskId: task.taskId, sources }, 'Nami charting the course — reading the winds');

    if (Math.random() < 0.25) {
      void notifier.send(Number(task.chatId), 'nami', 'fetching_context');
    }

    // Fetch live weather when the query is weather-related
    const weatherFinding = await this.fetchWeatherFinding(task.taskId, task.userRequest);

    const [localResult, githubResult] = await Promise.all([
      this.localSearch.search(task.taskId, task.userRequest),
      this.githubSearch
        ? this.githubSearch.search(task.taskId, task.userRequest)
        : Promise.resolve(null),
    ]);

    const allFindings = [
      ...(weatherFinding ? [weatherFinding] : []),
      ...localResult.findings,
      ...(githubResult?.findings ?? []),
    ]
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 10);

    const summaryParts = [localResult.summary];
    if (githubResult?.summary) summaryParts.push(githubResult.summary);

    const context: ContextResponse = {
      taskId: task.taskId,
      findings: allFindings,
      summary: summaryParts.filter(Boolean).join(' '),
      timestamp: new Date(),
    };

    this.logger.info(
      {
        taskId: task.taskId,
        localCount: localResult.findings.length,
        githubCount: githubResult?.findings.length ?? 0,
        totalCount: allFindings.length,
      },
      'Nami charted the course — context ready'
    );

    return context;
  }

  private async fetchWeatherFinding(
    _taskId: string,
    request: string,
  ): Promise<ContextResponse['findings'][number] | null> {
    if (!this.weatherService || !isWeatherQuery(request)) return null;
    try {
      const w = await this.weatherService.getCurrentWeather();
      if (!w) return null;
      return {
        source: 'live:weather',
        snippet: `Current weather: ${w.temperatureCelsius}°C, ${w.condition}. Wind: ${w.windSpeedKmh} km/h. (fetched ${w.fetchedAt.toISOString()})`,
        relevance: 0.98,
      };
    } catch {
      return null;
    }
  }
}

const WEATHER_TERMS = [
  'weather', 'temperature', 'hot', 'cold', 'warm', 'cool', 'rain', 'raining',
  'sunny', 'cloudy', 'snow', 'humid', 'outside', 'forecast', 'degrees',
  'celsius', 'wind', 'windy', 'storm', 'thunder',
];

function isWeatherQuery(request: string): boolean {
  const lower = request.toLowerCase();
  return WEATHER_TERMS.some(t => lower.includes(t));
}

// Words that appear ONLY in greetings/pleasantries — not in real queries
const GREETING_WORDS = new Set([
  'hello', 'hi', 'hey', 'howdy', 'greetings', 'yo', 'sup', 'hiya', 'hola',
  'morning', 'evening', 'afternoon', 'night', 'good',
  'bye', 'goodbye', 'later', 'ciao', 'cheers',
  'there', 'all', 'everyone', 'guys', 'folks', 'crew', 'team',
]);

function isCasualPhrase(request: string): boolean {
  const words = request.trim().toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 3) return false;
  // Only skip context if EVERY word in the request is a greeting word
  return words.every(w => GREETING_WORDS.has(w));
}
