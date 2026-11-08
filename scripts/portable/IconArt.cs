using System.Drawing;
using System.Drawing.Drawing2D;

static class IconArt
{
    public static Bitmap Draw(int size)
    {
        float scale = size / 64f;
        var bitmap = new Bitmap(size, size, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bitmap))
        using (var shape = Rounded(new RectangleF(0, 0, size, size), 16f * scale))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.Clear(Color.Transparent);
            using (var fill = new SolidBrush(Color.FromArgb(255, 7, 11, 20)))
                g.FillPath(fill, shape);
            g.SetClip(shape);
            using (var sheen = new LinearGradientBrush(
                new PointF(0, 0),
                new PointF(0, size * 0.62f),
                Color.FromArgb(36, 255, 255, 255),
                Color.FromArgb(0, 255, 255, 255)))
            {
                g.FillRectangle(sheen, 0, 0, size, size);
            }
            var mark = new[]
            {
                new PointF(16f * scale, 12f * scale),
                new PointF(30f * scale, 12f * scale),
                new PointF(30f * scale, 36f * scale),
                new PointF(48f * scale, 36f * scale),
                new PointF(48f * scale, 50f * scale),
                new PointF(16f * scale, 50f * scale)
            };
            using (var brush = new LinearGradientBrush(
                new PointF(16f * scale, 12f * scale),
                new PointF(48f * scale, 50f * scale),
                Color.FromArgb(61, 255, 242),
                Color.FromArgb(247, 37, 133)))
            {
                var blend = new ColorBlend(3);
                blend.Colors = new[]
                {
                    Color.FromArgb(61, 255, 242),
                    Color.FromArgb(91, 140, 255),
                    Color.FromArgb(247, 37, 133)
                };
                blend.Positions = new[] { 0f, 0.55f, 1f };
                brush.InterpolationColors = blend;
                g.FillPolygon(brush, mark);
            }
            g.ResetClip();
            using (var pen = new Pen(Color.FromArgb(90, 61, 255, 242), System.Math.Max(1f, 1.5f * scale)))
                g.DrawPath(pen, shape);
        }
        return bitmap;
    }

    static GraphicsPath Rounded(RectangleF bounds, float radius)
    {
        float diameter = radius * 2f;
        var path = new GraphicsPath();
        path.AddArc(bounds.X, bounds.Y, diameter, diameter, 180, 90);
        path.AddArc(bounds.Right - diameter, bounds.Y, diameter, diameter, 270, 90);
        path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(bounds.X, bounds.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }
}
