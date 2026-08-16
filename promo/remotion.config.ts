import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// High quality H.264 for a crisp square promo
Config.setCodec('h264');
Config.setCrf(18);
