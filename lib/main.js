"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const rest_1 = require("@octokit/rest");
const fs_1 = require("fs");
const minimatch_1 = __importDefault(require("minimatch"));
const openai_1 = __importDefault(require("openai"));
const parse_diff_1 = __importDefault(require("parse-diff"));
const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN');
const OPENAI_API_KEY = core.getInput('OPENAI_API_KEY');
const OPENAI_API_MODEL = core.getInput('OPENAI_API_MODEL');
const ROLE_DESCRIPTION = (_a = core.getInput('role_description')) !== null && _a !== void 0 ? _a : 'You are an expert developer.';
const MAX_TOKENS = Number(core.getInput('max_tokens'));
/**
 * @see https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/json-mode?tabs=python
 * gpt-35-turbo (1106)
 * gpt-35-turbo (0125)
 * gpt-4 (1106-Preview)
 * gpt-4 (0125-Preview)
 * gpt-4o
 * gpt-4o-mini
 */
const SUPPORTS_JSON_FORMAT = ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'];
const octokit = new rest_1.Octokit({ auth: GITHUB_TOKEN });
const openai = new openai_1.default({
    apiKey: OPENAI_API_KEY,
});
function getPRDetails() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const { repository, number } = JSON.parse((0, fs_1.readFileSync)(process.env.GITHUB_EVENT_PATH || '', 'utf8'));
        const prResponse = yield octokit.pulls.get({
            owner: repository.owner.login,
            repo: repository.name,
            pull_number: number,
        });
        return {
            owner: repository.owner.login,
            repo: repository.name,
            pull_number: number,
            title: (_a = prResponse.data.title) !== null && _a !== void 0 ? _a : '',
            description: (_b = prResponse.data.body) !== null && _b !== void 0 ? _b : '',
        };
    });
}
function getDiff(owner, repo, pull_number) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield octokit.pulls.get({
            owner,
            repo,
            pull_number,
            mediaType: { format: 'diff' },
        });
        // @ts-expect-error - response.data is a string
        return response.data;
    });
}
function analyzeCode(parsedDiff, prDetails) {
    return __awaiter(this, void 0, void 0, function* () {
        const comments = [];
        for (const file of parsedDiff) {
            if (file.to === '/dev/null')
                continue; // Ignore deleted files
            for (const chunk of file.chunks) {
                const prompt = createPrompt(file, chunk, prDetails);
                console.log('Prompt: ', prompt);
                const aiResponse = yield getAIResponse(prompt);
                if (aiResponse) {
                    const newComments = createComment(file, chunk, aiResponse);
                    if (newComments) {
                        comments.push(...newComments);
                    }
                }
            }
        }
        return comments;
    });
}
function createPrompt(file, chunk, prDetails) {
    return `${ROLE_DESCRIPTION}
Your task is to review pull requests. Instructions:
- Provide the response in following JSON format:  {"reviews": [{"lineNumber":  <line_number>, "reviewComment": "<review comment>"}]}
- Do not give positive comments or compliments.
- Provide comments and suggestions ONLY if there is something to improve, otherwise "reviews" should be an empty array.
- Write the comment in GitHub Markdown format.
- Use the given description only for the overall context and only comment the code.
- IMPORTANT: NEVER suggest adding comments to the code.

Review the following code diff in the file "${file.to}" and take the pull request title and description into account when writing the response.
  
Pull request title: ${prDetails.title}
Pull request description:

---
${prDetails.description}
---

Git diff to review:

\`\`\`diff
${chunk.content}
${chunk.changes
        // @ts-expect-error - ln and ln2 exists where needed
        .map((c) => `${c.ln ? c.ln : c.ln2} ${c.content}`)
        .join('\n')}
\`\`\`
`;
}
function getAIResponse(prompt) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const queryConfig = {
            model: OPENAI_API_MODEL,
            temperature: 0.2,
            max_tokens: MAX_TOKENS,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
        };
        let response = null;
        try {
            response = yield openai.chat.completions.create(Object.assign(Object.assign(Object.assign({}, queryConfig), (SUPPORTS_JSON_FORMAT.includes(OPENAI_API_MODEL)
                ? { response_format: { type: 'json_object' } }
                : {})), { messages: [
                    {
                        role: 'system',
                        content: prompt,
                    },
                ] }));
            const finish_response = response.choices[0].finish_reason;
            if (finish_response === 'length') {
                console.log('The maximum context length has been exceeded. Please reduce the length of the code snippets.');
                return null;
            }
            const res = ((_b = (_a = response.choices[0].message) === null || _a === void 0 ? void 0 : _a.content) === null || _b === void 0 ? void 0 : _b.trim()) || '{}';
            if (res.startsWith('```json')) {
                console.log('Within JSON tag: ', res.slice(7, -3));
                return JSON.parse(res.slice(7, -3)).reviews;
            }
            else {
                return JSON.parse(res).reviews;
            }
        }
        catch (error) {
            console.log('Content: ', (_d = (_c = response === null || response === void 0 ? void 0 : response.choices[0]) === null || _c === void 0 ? void 0 : _c.message) === null || _d === void 0 ? void 0 : _d.content);
            console.error('Error: ', error);
            return null;
        }
    });
}
function createComment(file, chunk, aiResponses) {
    return aiResponses.flatMap((aiResponse) => {
        if (!file.to) {
            return [];
        }
        return {
            body: aiResponse.reviewComment,
            path: file.to,
            line: Number(aiResponse.lineNumber),
        };
    });
}
function createReviewComment(owner, repo, pull_number, comments) {
    return __awaiter(this, void 0, void 0, function* () {
        yield octokit.pulls.createReview({
            owner,
            repo,
            pull_number,
            comments,
            event: 'COMMENT',
        });
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const prDetails = yield getPRDetails();
        let diff;
        const eventData = JSON.parse((0, fs_1.readFileSync)((_a = process.env.GITHUB_EVENT_PATH) !== null && _a !== void 0 ? _a : '', 'utf8'));
        if (eventData.action === 'opened') {
            diff = yield getDiff(prDetails.owner, prDetails.repo, prDetails.pull_number);
        }
        else if (eventData.action === 'synchronize') {
            const newBaseSha = eventData.before;
            const newHeadSha = eventData.after;
            const response = yield octokit.repos.compareCommits({
                headers: {
                    accept: 'application/vnd.github.v3.diff',
                },
                owner: prDetails.owner,
                repo: prDetails.repo,
                base: newBaseSha,
                head: newHeadSha,
            });
            diff = String(response.data);
        }
        else {
            console.log('Unsupported event:', process.env.GITHUB_EVENT_NAME);
            return;
        }
        if (!diff) {
            console.log('No diff found');
            return;
        }
        const parsedDiff = (0, parse_diff_1.default)(diff);
        const excludePatterns = core
            .getInput('exclude')
            .split(',')
            .map((s) => s.trim());
        const filteredDiff = parsedDiff.filter((file) => {
            return !excludePatterns.some((pattern) => { var _a; return (0, minimatch_1.default)((_a = file.to) !== null && _a !== void 0 ? _a : '', pattern); });
        });
        const comments = yield analyzeCode(filteredDiff, prDetails);
        if (comments.length > 0) {
            yield createReviewComment(prDetails.owner, prDetails.repo, prDetails.pull_number, comments);
        }
    });
}
main().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
});
