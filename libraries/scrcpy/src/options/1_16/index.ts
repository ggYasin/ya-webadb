import { BufferedStreamEndedError, ReadableStream, TransformStream, type Adb, type AdbBufferedStream } from "@yume-chan/adb";
import Struct, { placeholder } from "@yume-chan/struct";
import type { AndroidCodecLevel, AndroidCodecProfile } from "../../codec.js";
import { ScrcpyClientConnection, ScrcpyClientForwardConnection, ScrcpyClientReverseConnection, type ScrcpyClientConnectionOptions } from "../../connection.js";
import { AndroidKeyEventAction, ScrcpyControlMessageType } from "../../message.js";
import type { ScrcpyBackOrScreenOnEvent1_18 } from "../1_18.js";
import type { ScrcpyInjectScrollControlMessage1_22 } from "../1_22.js";
import { toScrcpyOptionValue, type ScrcpyOptions, type ScrcpyOptionValue, type VideoStreamPacket } from "../common.js";
import { parse_sequence_parameter_set } from "./sps.js";

export enum ScrcpyLogLevel {
    Verbose = 'verbose',
    Debug = 'debug',
    Info = 'info',
    Warn = 'warn',
    Error = 'error',
}

export enum ScrcpyScreenOrientation {
    Initial = -2,
    Unlocked = -1,
    Portrait = 0,
    Landscape = 1,
    PortraitFlipped = 2,
    LandscapeFlipped = 3,
}

export interface CodecOptionsInit {
    profile: AndroidCodecProfile;

    level: AndroidCodecLevel;
}

export class CodecOptions implements ScrcpyOptionValue {
    public value: Partial<CodecOptionsInit>;

    public constructor(value: Partial<CodecOptionsInit>) {
        this.value = value;
    }

    public toOptionValue(): string | undefined {
        const entries = Object.entries(this.value)
            .filter(([key, value]) => value !== undefined);

        if (entries.length === 0) {
            return undefined;
        }

        return entries
            .map(([key, value]) => `${key}=${value}`)
            .join(',');
    }
}

export interface ScrcpyOptionsInit1_16 {
    logLevel: ScrcpyLogLevel;

    /**
     * The maximum value of both width and height.
     */
    maxSize: number;

    bitRate: number;

    /**
     * 0 for unlimited.
     *
     * @default 0
     */
    maxFps: number;

    /**
     * The orientation of the video stream.
     *
     * It will not keep the device screen in specific orientation,
     * only the captured video will in this orientation.
     */
    lockVideoOrientation: ScrcpyScreenOrientation;

    tunnelForward: boolean;

    crop: string;

    /**
     * Send PTS so that the client may record properly
     *
     * Note: When `sendFrameMeta: false` is specified,
     * `onChangeEncoding` event won't fire and `onVideoData` event doesn't
     * merge sps/pps frame and first video frame. Which means you can't use
     * the shipped decoders to render the video
     * (You can still record the stream into a file).
     *
     * @default true
     */
    sendFrameMeta: boolean;

    /**
     * @default true
     */
    control: boolean;

    displayId: number;

    showTouches: boolean;

    stayAwake: boolean;

    codecOptions: CodecOptions;

    encoderName: string;
}

export const VideoPacket =
    new Struct()
        .int64('pts')
        .uint32('size')
        .uint8Array('data', { lengthField: 'size' });

export const NoPts = BigInt(-1);

export const ScrcpyBackOrScreenOnEvent1_16 =
    new Struct()
        .uint8('type', placeholder<ScrcpyControlMessageType.BackOrScreenOn>());

export const ScrcpyInjectScrollControlMessage1_16 =
    new Struct()
        .uint8('type', ScrcpyControlMessageType.InjectScroll as const)
        .uint32('pointerX')
        .uint32('pointerY')
        .uint16('screenWidth')
        .uint16('screenHeight')
        .int32('scrollX')
        .int32('scrollY');

export class ScrcpyOptions1_16<T extends ScrcpyOptionsInit1_16 = ScrcpyOptionsInit1_16> implements ScrcpyOptions<T> {
    public value: Partial<T>;

    public constructor(value: Partial<ScrcpyOptionsInit1_16>) {
        if (new.target === ScrcpyOptions1_16 &&
            value.logLevel === ScrcpyLogLevel.Verbose) {
            value.logLevel = ScrcpyLogLevel.Debug;
        }

        if (new.target === ScrcpyOptions1_16 &&
            value.lockVideoOrientation === ScrcpyScreenOrientation.Initial) {
            value.lockVideoOrientation = ScrcpyScreenOrientation.Unlocked;
        }

        this.value = value as Partial<T>;
    }

    protected getArgumentOrder(): (keyof T)[] {
        return [
            'logLevel',
            'maxSize',
            'bitRate',
            'maxFps',
            'lockVideoOrientation',
            'tunnelForward',
            'crop',
            'sendFrameMeta',
            'control',
            'displayId',
            'showTouches',
            'stayAwake',
            'codecOptions',
            'encoderName',
        ];
    }

    protected getDefaultValue(): T {
        return {
            logLevel: ScrcpyLogLevel.Debug,
            maxSize: 0,
            bitRate: 8_000_000,
            maxFps: 0,
            lockVideoOrientation: ScrcpyScreenOrientation.Unlocked,
            tunnelForward: false,
            crop: '-',
            sendFrameMeta: true,
            control: true,
            displayId: 0,
            showTouches: false,
            stayAwake: false,
            codecOptions: new CodecOptions({}),
            encoderName: '-',
        } as T;
    }

    public formatServerArguments(): string[] {
        const defaults = this.getDefaultValue();
        return this.getArgumentOrder()
            .map(key => toScrcpyOptionValue(this.value[key] || defaults[key], '-'));
    }

    public createConnection(adb: Adb): ScrcpyClientConnection {
        const options: ScrcpyClientConnectionOptions = {
            // Old scrcpy connection always have control stream no matter what the option is
            control: true,
            sendDummyByte: true,
            sendDeviceMeta: true,
        };
        if (this.value.tunnelForward) {
            return new ScrcpyClientForwardConnection(adb, options);
        } else {
            return new ScrcpyClientReverseConnection(adb, options);
        }
    }

    public getOutputEncoderNameRegex(): RegExp {
        return /\s+scrcpy --encoder-name '(.*?)'/;
    }

    public parseVideoStream(stream: AdbBufferedStream): ReadableStream<VideoStreamPacket> {
        // Optimized path for video frames only
        if (this.value.sendFrameMeta === false) {
            return stream
                .release()
                .pipeThrough(new TransformStream<Uint8Array, VideoStreamPacket>({
                    transform(chunk, controller) {
                        controller.enqueue({
                            type: 'frame',
                            data: chunk,
                        });
                    },
                }));
        }

        let header: Uint8Array | undefined;

        return new ReadableStream<VideoStreamPacket>({
            async pull(controller) {
                try {
                    const { pts, data } = await VideoPacket.deserialize(stream);
                    if (pts === NoPts) {
                        const sequenceParameterSet = parse_sequence_parameter_set(data.slice().buffer);

                        const {
                            profile_idc: profileIndex,
                            constraint_set: constraintSet,
                            level_idc: levelIndex,
                            pic_width_in_mbs_minus1,
                            pic_height_in_map_units_minus1,
                            frame_mbs_only_flag,
                            frame_crop_left_offset,
                            frame_crop_right_offset,
                            frame_crop_top_offset,
                            frame_crop_bottom_offset,
                        } = sequenceParameterSet;

                        const encodedWidth = (pic_width_in_mbs_minus1 + 1) * 16;
                        const encodedHeight = (pic_height_in_map_units_minus1 + 1) * (2 - frame_mbs_only_flag) * 16;
                        const cropLeft = frame_crop_left_offset * 2;
                        const cropRight = frame_crop_right_offset * 2;
                        const cropTop = frame_crop_top_offset * 2;
                        const cropBottom = frame_crop_bottom_offset * 2;

                        const croppedWidth = encodedWidth - cropLeft - cropRight;
                        const croppedHeight = encodedHeight - cropTop - cropBottom;

                        header = data;
                        controller.enqueue({
                            type: 'configuration',
                            data: {
                                profileIndex,
                                constraintSet,
                                levelIndex,
                                encodedWidth,
                                encodedHeight,
                                cropLeft,
                                cropRight,
                                cropTop,
                                cropBottom,
                                croppedWidth,
                                croppedHeight,
                            }
                        });
                        return;
                    }

                    let frameData: Uint8Array;
                    if (header) {
                        frameData = new Uint8Array(header.byteLength + data.byteLength);
                        frameData.set(header);
                        frameData.set(data!, header.byteLength);
                        header = undefined;
                    } else {
                        frameData = data;
                    }

                    controller.enqueue({
                        type: 'frame',
                        data: frameData,
                    });
                } catch (e) {
                    if (e instanceof BufferedStreamEndedError) {
                        controller.close();
                        return;
                    }

                    throw e;
                }
            }
        });
    }

    public serializeBackOrScreenOnControlMessage(
        message: ScrcpyBackOrScreenOnEvent1_18,
    ) {
        if (message.action === AndroidKeyEventAction.Down) {
            return ScrcpyBackOrScreenOnEvent1_16.serialize(message);
        }

        return undefined;
    }

    public serializeInjectScrollControlMessage(
        message: ScrcpyInjectScrollControlMessage1_22,
    ): Uint8Array {
        return ScrcpyInjectScrollControlMessage1_16.serialize(message);
    }
}
