"use client";
import { SectionTabs, useTab } from "@/components/SectionTabs";
import PosterView from "@/components/views/PosterView";
import { CarouselStudio } from "@/components/CarouselStudio";
import { VideoStudio } from "@/components/VideoStudio";

/* The Studio: where content is made, by format. An image from a template and our own
   photograph; a carousel made as a whole set; a reel cut from our own footage. Each can go
   straight onto the calendar, and from there to Content status. */
const TABS = [{ key: "image", label: "Image" }, { key: "carousel", label: "Carousel" }, { key: "video", label: "Video" }];

export default function StudioPage() {
  const [tab, setTab] = useTab(TABS, "image");
  return (
    <div className="stack">
      <SectionTabs title="Studio" tabs={TABS} active={tab} onPick={setTab} />
      {tab === "video" ? <VideoStudio /> : tab === "carousel" ? <CarouselStudio /> : <PosterView groups={["Product", "Crew"]} />}
    </div>
  );
}
