import { NextResponse, type NextRequest } from "next/server";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { activeSession } from "@/lib/auth";
import { formatDateTime, today } from "@/lib/format";
import { buildReport, REPORT_TYPES, toCsv, type Report, type ReportType } from "@/modules/reports/data";

export const runtime = "nodejs";

function toPdf(report: Report, generatedBy: string, range: string): ArrayBuffer {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const left = 40;
  doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(18, 60, 43);
  doc.text(`Cypher Green Systems (CGS): ${report.title}`, left, 44);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(95, 106, 99);
  doc.text(`Generated ${formatDateTime(new Date().toISOString())} (EAT) by ${generatedBy}. ${report.dateField}: ${range}.`, left, 60);

  autoTable(doc, {
    startY: 74,
    margin: { left, right: left },
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 2, textColor: [32, 43, 38] },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 220 } },
    body: report.summary,
  });
  autoTable(doc, {
    margin: { left, right: left },
    head: [report.columns],
    body: report.rows.map((row) => row.map((value) => String(value ?? ""))),
    styles: { fontSize: 7.5, cellPadding: 3, overflow: "linebreak", textColor: [32, 43, 38], lineColor: [224, 229, 223], lineWidth: 0.5 },
    headStyles: { fillColor: [18, 60, 43], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 248, 244] },
  });

  const notes = [...report.notes, ...(report.truncated ? [`Only the first ${report.rows.length} rows are included. Narrow the date range for a complete export.`] : [])];
  if (notes.length) {

    let y = ((doc as any).lastAutoTable?.finalY ?? 80) + 18;
    doc.setFontSize(8).setTextColor(95, 106, 99);
    for (const note of notes) {
      const lines = doc.splitTextToSize(`Note: ${note}`, 760);
      if (y + lines.length * 10 > 560) {
        doc.addPage();
        y = 44;
      }
      doc.text(lines, left, y);
      y += lines.length * 10 + 4;
    }
  }
  return doc.output("arraybuffer");
}

/** CSV / PDF export of a report, limited to the records the signed-in user may read. */
export async function GET(request: NextRequest) {
  const session = await activeSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const type = params.get("type") ?? "";
  const format = params.get("format");
  if (!(type in REPORT_TYPES) || (format !== "csv" && format !== "pdf")) {
    return NextResponse.json({ error: "Unknown report type or format" }, { status: 400 });
  }
  const filters = { project: params.get("project") ?? undefined, from: params.get("from") ?? undefined, to: params.get("to") ?? undefined };

  try {
    const report = await buildReport(session.supabase, type as ReportType, filters);
    const fileName = `cgs-${type}-report-${today()}.${format}`;
    const range = `${filters.from || "start"} to ${filters.to || "today"}`;
    const body = format === "csv" ? toCsv(report) : toPdf(report, session.profile.full_name, range);
    return new NextResponse(body, {
      headers: {
        "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Report export failed:", error);
    return NextResponse.json({ error: "The report could not be generated" }, { status: 500 });
  }
}
