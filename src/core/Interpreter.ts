import type { Channel } from 'discord.js';
import type { CommandData, HelpersData, TemporarilyData, InterpreterOptions, FunctionData } from '../typings';
import * as Discord from 'discord.js';
import type { Context, FunctionsManager, ShouwClient as Client } from '../classes';
import { CheckCondition, IF } from './';
import * as chalk from 'chalk';

export class Interpreter {
    public readonly client: Client;
    public readonly functions: FunctionsManager;
    public readonly debug: boolean | undefined;

    public code: string;
    public command: CommandData;
    public channel?: Channel;
    public guild?: Discord.Guild;
    public member?: Discord.GuildMember;
    public user?: Discord.User;
    public context?: Context;
    public args?: string[];
    public content: string | null;
    public embeds: Discord.EmbedBuilder[];
    public attachments: Discord.AttachmentBuilder[];
    public components: Discord.ActionRowBuilder[];
    public stickers: Discord.Sticker[];
    public flags: number | string | bigint | null;
    public message: Discord.Message | null;
    public noop: () => void = () => {};
    public helpers: HelpersData;
    public Temporarily: TemporarilyData;
    public discord: typeof Discord = Discord;

    constructor(cmd: CommandData, options: InterpreterOptions) {
        this.client = options.client;
        this.functions = this.client.functions;
        this.debug = options.debug;
        this.code = cmd.code;
        this.command = cmd;
        this.channel = options.channel;
        this.guild = options.guild;
        this.member = options.member;
        this.user = options.user;
        this.context = options.context;
        this.args = options.args;
        this.content = null;
        this.embeds = [];
        this.attachments = [];
        this.components = [];
        this.stickers = [];
        this.flags = null;
        this.message = null;
        this.helpers = {
            condition: CheckCondition,
            interpreter: Interpreter,
            unescape: (str: string) => str.unescape(),
            escape: (str: string) => str.escape()
        };
        this.Temporarily =
            (options.Temporarily as TemporarilyData) ??
            ({
                arrays: {},
                variables: {},
                splits: [],
                randoms: {},
                timezone: 'UTC'
            } as TemporarilyData);
    }

    public async initialize() {
        let result = this.code;
        let error = false;

        const processFunction = async (code: string): Promise<string> => {
            const functions = this.extractFunctions(code);
            if (functions.length === 0) return code;
            let currentCode = code;
            for (const func of functions) {
                if (func.match(/(\$if|\$endif)$/i)) {
                    const RESULT = await IF(currentCode, this);
                    if (RESULT.error) {
                        error = true;
                        break;
                    }

                    currentCode = await processFunction(RESULT.code);
                    break;
                }

                const unpacked = this.unpack(func, currentCode);
                if (!unpacked.all) continue;
                const functionData: FunctionData | undefined = this.functions.get(func);
                if (!functionData || !functionData.code || typeof functionData.code !== 'function') continue;
                if (functionData.brackets && !unpacked.brackets) {
                    const funcWithParams = `${func}[${functionData.params?.map((x) => x.name).join(';')}]`;
                    await this.error({
                        message: `Invalid ${func} usage: Missing brackets`,
                        solution: `Make sure to add brackets to the function. Example: ${funcWithParams}`
                    });

                    error = true;
                    break;
                }

                const processedArgs: Array<unknown> = [];
                if (unpacked.args.length > 0) {
                    for (const arg of unpacked.args) {
                        if (!arg) {
                            processedArgs.push(void 0);
                            continue;
                        }

                        if ((typeof arg === 'string' && !arg.match(/\$/g)) || typeof arg !== 'string') {
                            processedArgs.push(arg);
                            continue;
                        }

                        const processed = await processFunction(arg);
                        processedArgs.push(processed);
                    }
                }

                const DATA =
                    (await functionData.code(
                        {
                            ...this,
                            interpreter: Interpreter,
                            data: this.Temporarily
                        },
                        processedArgs,
                        this.Temporarily
                    )) ?? {};

                const result = DATA.result?.toString().escape() ?? '';
                currentCode = currentCode.replace(unpacked.all, result);
                if (DATA.error === true) {
                    error = true;
                    break;
                }
                if (DATA.embeds) {
                    this.embeds = DATA.embeds;
                }
                if (DATA.attachments) {
                    this.attachments = DATA.attachments;
                }
                if (DATA.components) {
                    this.components = DATA.components;
                }
                if (DATA.stickers) {
                    this.stickers = DATA.stickers;
                }
                if (DATA.flags) {
                    this.flags = DATA.flags;
                }
                if (DATA.message) {
                    this.message = DATA.message;
                }
            }

            return currentCode.unescape().trim();
        };

        result = await processFunction(result);
        this.code = result;

        if (
            error === false &&
            ((this.code && this.code !== '') ||
                this.components.length > 0 ||
                this.embeds.length > 0 ||
                this.attachments.length > 0)
        ) {
            this.message = (await this.context?.send({
                content: this.code !== '' ? this.code : null,
                embeds: this.embeds,
                components: this.components,
                files: this.attachments,
                flags: this.flags
            })) as Discord.Message;
        }

        return {
            error: error,
            id: this.message?.id,
            result: error ? null : this.code
        };
    }

    private unpack(
        func: string,
        code: string
    ): {
        func: string;
        args: Array<unknown>;
        brackets: boolean;
        all: string | null;
    } {
        const funcStart = code.toLowerCase().indexOf(func.toLowerCase());
        if (funcStart === -1) return { func, args: [], brackets: false, all: null };

        if (funcStart > 0 && code[funcStart - 1] === '$') {
            return { func, args: [], brackets: false, all: func };
        }

        const openBracketIndex = code.indexOf('[', funcStart);
        if (openBracketIndex === -1) return { func, args: [], brackets: false, all: func };

        const textBetween = code.slice(funcStart + func.length, openBracketIndex).trim();
        if (textBetween.includes('$')) {
            return { func, args: [], brackets: false, all: func };
        }

        let bracketStack = 0;
        let closeBracketIndex = openBracketIndex;

        while (closeBracketIndex < code.length) {
            const char = code[closeBracketIndex];
            if (char === '[') {
                bracketStack++;
            } else if (char === ']') {
                bracketStack--;
                if (bracketStack === 0) break;
            }

            closeBracketIndex++;
        }

        if (closeBracketIndex >= code.length || bracketStack > 0) {
            return { func, args: [], brackets: false, all: func };
        }

        const argsStr = code.slice(openBracketIndex + 1, closeBracketIndex).trim();
        const args = this.extractArguments(argsStr);
        const all = code.slice(funcStart, closeBracketIndex + 1);

        return { func, args, brackets: true, all };
    }

    private extractArguments(argsStr: string): Array<string> {
        const args: string[] = [];
        let depth = 0;
        let currentArg = '';

        for (let i = 0; i < argsStr.length; i++) {
            const char = argsStr[i];

            if (char === '[') {
                depth++;
                currentArg += char;
            } else if (char === ']') {
                depth--;
                currentArg += char;
            } else if (char === ';' && depth === 0) {
                args.push(currentArg.trim());
                currentArg = '';
            } else {
                currentArg += char;
            }
        }

        if (currentArg.trim()) args.push(currentArg.trim());

        // @ts-ignore
        return args.map((arg: string) => {
            if (arg !== '') return arg.unescape();
            return void 0;
        });
    }

    private extractFunctions(code = this.code): Array<string> {
        const lines = code.split(/\n/)?.filter((line) => line.trim() !== '' || line);
        const functions: string[] = [];

        for (const line of lines) {
            const splited = line.split('$').filter((x: string) => x.trim() !== '');
            const lineFunctions: string[] = [];

            for (const part of splited) {
                const matchingFunctions = [...this.functions.K, '$if', '$endif'].filter(
                    (func) => func.toLowerCase() === `$${part.toLowerCase()}`.slice(0, func.length)
                );

                if (matchingFunctions.length === 1) {
                    lineFunctions.push(matchingFunctions[0]);
                } else if (matchingFunctions.length > 1) {
                    lineFunctions.push(matchingFunctions.sort((a, b) => b.length - a.length)[0]);
                }
            }

            if (lineFunctions.length > 0) functions.push(...lineFunctions.reverse());
        }

        return functions;
    }

    public async error(options: { message: string; solution?: string }) {
        try {
            await this.context?.send(
                `\`\`\`\n🚫 ${options.message}${options.solution ? `\n\nSo, what is the solution?\n${options.solution}` : ''}\`\`\``
            );
        } catch {
            console.log(`[${chalk.red('ERROR')}]: ${options.message}`);
            if (options.solution) console.log(`[${chalk.green('SOLUTION')}]: ${options.solution}`);
        }
    }
}
