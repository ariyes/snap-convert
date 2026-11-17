# Camera RAW test files

Downloaded by `pnpm fixtures:raw` (`scripts/fixtures-raw.ts`) into `cache/` (git-ignored, ~250 MB).
Every file comes from [raw.pixls.us](https://raw.pixls.us/) and is marked there **CC0 1.0
(public domain)**: the licence column of the site's repository table
(`https://raw.pixls.us/json/getrepository.php?set=all`) links each one to
<https://creativecommons.org/publicdomain/zero/1.0/>. The script checks each file's SHA-256 (the
checksum the site publishes).

| File                 | Camera                   | Why it's here                                                                      | Source                                                                                                                            | Licence |
| -------------------- | ------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `canon-1100d.cr2`    | Canon EOS 1100D, 12 MP   | CR2 with a full-size camera JPEG                                                   | <https://raw.pixls.us/getfile.php/1744/nice/Canon%20-%20EOS%201100D%20-%20RAW%20(3:2).CR2>                                        | CC0 1.0 |
| `canon-m50.cr3`      | Canon EOS M50, 24 MP     | CR3 with a full-size camera JPEG (fast-mode timing, fast vs full quality test)     | <https://raw.pixls.us/getfile.php/4656/nice/Canon%20-%20EOS%20M50%20-%203:2.CR3>                                                  | CC0 1.0 |
| `canon-r8.cr3`       | Canon EOS R8, 24 MP      | CR3 whose full-size preview is HEIF (HDR PQ), not JPEG: fast mode must develop     | <https://raw.pixls.us/getfile.php/6587/nice/Canon%20-%20EOS%20R8%20-%203:2.CR3>                                                   | CC0 1.0 |
| `nikon-d500.nef`     | Nikon D500, 21 MP        | NEF (lossy compressed) with a full-size camera JPEG                                | <https://raw.pixls.us/getfile.php/2504/nice/Nikon%20-%20D500%20-%2012bit%2012bit%20compressed%20(Lossy%20(type%202))%20(3:2).NEF> | CC0 1.0 |
| `nikon-zf.nef`       | Nikon Z f, 24 MP         | High-efficiency NEF (LibRaw can't read it; FlashRaw can)                           | <https://raw.pixls.us/getfile.php/6887/nice/Nikon%20-%20Z%20f%20-%208bit%208bit%20lossy%20compressed%20(3:2).NEF>                 | CC0 1.0 |
| `sony-a6400.arw`     | Sony ILCE-6400, 24 MP    | ARW; camera JPEG only 1616 px, so fast mode develops; the 24 MP white-balance test | <https://raw.pixls.us/getfile.php/3406/nice/Sony%20-%20ILCE-6400%20-%2012bit%2012bit%20compressed%20(3:2).ARW>                    | CC0 1.0 |
| `sony-a7r4-61mp.arw` | Sony ILCE-7RM4, 61 MP    | The ≥ 45 MP memory tests (half size on phones, WebKit)                             | <https://raw.pixls.us/getfile.php/3479/nice/Sony%20-%20ILCE-7RM4%20-%2012bit%2012bit%20compressed%20(3:2).ARW>                    | CC0 1.0 |
| `ricoh-gr.dng`       | Ricoh GR, 16 MP          | Adobe DNG (camera-native)                                                          | <https://raw.pixls.us/getfile.php/996/nice/Ricoh%20-%20GR%20-%2012bit%20(4:3).DNG>                                                | CC0 1.0 |
| `fuji-xs10.raf`      | Fujifilm X-S10, 26 MP    | RAF, X-Trans sensor                                                                | <https://raw.pixls.us/getfile.php/4190/nice/Fujifilm%20-%20X-S10%20-%2014bit%2014bit%20compressed%20(3:2).RAF>                    | CC0 1.0 |
| `olympus-ep5.orf`    | Olympus E-P5, 16 MP      | ORF                                                                                | <https://raw.pixls.us/getfile.php/1090/nice/Olympus%20-%20E-P5%20-%2016bit%20(4:3).ORF>                                           | CC0 1.0 |
| `panasonic-g81.rw2`  | Panasonic DMC-G81, 16 MP | RW2                                                                                | <https://raw.pixls.us/getfile.php/1518/nice/Panasonic%20-%20DMC-G81%20-%204:3.RW2>                                                | CC0 1.0 |
| `pentax-k5iis.pef`   | Pentax K-5 II s, 16 MP   | PEF with a full-size camera JPEG                                                   | <https://raw.pixls.us/getfile.php/1198/nice/Pentax%20-%20K-5%20II%20s%20-%2014bit%20(3:2).PEF>                                    | CC0 1.0 |
| `samsung-nx500.srw`  | Samsung NX500, 28 MP     | SRW with a full-size camera JPEG                                                   | <https://raw.pixls.us/getfile.php/3668/nice/Samsung%20-%20NX500%20-%2012bit%2012bit%20normal%20compression%20(3:2).SRW>           | CC0 1.0 |

## Made from the files above

raw.pixls.us asks contributors for landscape shots, and none of the ~400 smallest CC0 samples of
these brands carries a rotated orientation. So the script makes two portrait test files by changing
only the EXIF Orientation tag of IFD0 (allowed by CC0; they stay CC0):

| File                        | Made from          | Orientation                                                                         |
| --------------------------- | ------------------ | ----------------------------------------------------------------------------------- |
| `ricoh-gr-portrait.dng`     | `ricoh-gr.dng`     | 6 (rotate 90° clockwise): the full develop must come out 3264 × 4928                |
| `pentax-k5iis-portrait.pef` | `pentax-k5iis.pef` | 8 (rotate 90° anticlockwise): the camera JPEG (fast mode) must come out upright too |
