import Link from "next/link";

const features = [
  {
    title: "Reminders on your terms",
    text: "Create a reminder with a due time and pick a channel — email, WhatsApp, an AI agent, a signed webhook or a Razorpay order.",
  },
  {
    title: "Queue-backed delivery",
    text: "A BullMQ delayed job fires at the due time; the worker delivers through the channel adapter and records every attempt.",
  },
  {
    title: "Files attached to life",
    text: "Upload attachments (invoice scans, tickets, notes) straight from the reminder page — stored in MinIO, linked to the reminder.",
  },
];

export default function HomePage() {
  return (
    <div className="hero">
      <h1>
        Your life, on autopilot.
        <span className="hero-sub"> This is the first runnable slice: accounts → reminders → queued delivery → attempts you can see.</span>
      </h1>
      <div className="hero-actions">
        <Link href="/signup" className="btn btn-primary btn-lg">
          Get started
        </Link>
        <Link href="/reminders" className="btn btn-secondary btn-lg">
          View reminders
        </Link>
      </div>
      <div className="cards">
        {features.map((f) => (
          <section key={f.title} className="card">
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
