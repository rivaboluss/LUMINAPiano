using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

static class MakeIconProgram
{
    static void Main(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("usage: MakeIcon.exe <lumina.ico> <favicon.ico> [preview.png]");
            Environment.Exit(1);
        }
        int[] sizes = { 16, 24, 32, 48, 64, 256 };
        var bitmaps = new Bitmap[sizes.Length];
        var pngs = new byte[sizes.Length][];
        for (int i = 0; i < sizes.Length; i++)
        {
            bitmaps[i] = IconArt.Draw(sizes[i]);
            using (var stream = new MemoryStream())
            {
                bitmaps[i].Save(stream, ImageFormat.Png);
                pngs[i] = stream.ToArray();
            }
        }
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(args[0])));
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(args[1])));
        WriteIco(args[0], sizes, pngs);
        WriteIco(args[1], sizes, pngs);
        if (args.Length > 2)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(args[2])));
            bitmaps[bitmaps.Length - 1].Save(args[2], ImageFormat.Png);
        }
        for (int i = 0; i < bitmaps.Length; i++) bitmaps[i].Dispose();
    }

    static void WriteIco(string path, int[] sizes, byte[][] pngs)
    {
        using (var stream = File.Create(path))
        using (var writer = new BinaryWriter(stream))
        {
            writer.Write((ushort)0);
            writer.Write((ushort)1);
            writer.Write((ushort)pngs.Length);
            int offset = 6 + (16 * pngs.Length);
            for (int i = 0; i < pngs.Length; i++)
            {
                int side = sizes[i] >= 256 ? 0 : sizes[i];
                writer.Write((byte)side);
                writer.Write((byte)side);
                writer.Write((byte)0);
                writer.Write((byte)0);
                writer.Write((ushort)1);
                writer.Write((ushort)32);
                writer.Write(pngs[i].Length);
                writer.Write(offset);
                offset += pngs[i].Length;
            }
            for (int i = 0; i < pngs.Length; i++) writer.Write(pngs[i]);
        }
    }
}
