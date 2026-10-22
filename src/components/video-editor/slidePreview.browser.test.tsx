import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import "@/index.css";
import fixtureUrl from "../../../tests/fixtures/clip-colors-and-tone.webm?url";
import type { BlankSlideRegion } from "./types";
import VideoPlayback, { type VideoPlaybackRef } from "./VideoPlayback";

afterEach(cleanup);

it("updates the actual editor preview immediately when a paused slide is moved or deleted", async () => {
	const open = document.createElement("button");
	open.textContent = "Open editor preview";
	document.body.append(open);
	await userEvent.click(open);
	open.remove();
	const playback = createRef<VideoPlaybackRef>();
	function Preview() {
		const [time, setTime] = useState(0);
		const [playing, setPlaying] = useState(false);
		const [slides, setSlides] = useState<BlankSlideRegion[]>([
			{ id: "slide", startMs: 500, endMs: 1500, backgroundColor: "#fff" },
		]);
		return (
			<>
				<div style={{ width: 640, height: 360 }}>
					<VideoPlayback
						ref={playback}
						videoPath={fixtureUrl}
						webcamLayoutPreset="picture-in-picture"
						aspectRatio="16:9"
						currentTime={time}
						isPlaying={playing}
						onTimeUpdate={setTime}
						onPlayStateChange={setPlaying}
						onDurationChange={() => undefined}
						onError={(error) => {
							throw new Error(error);
						}}
						zoomRegions={[]}
						selectedZoomId={null}
						onSelectZoom={() => undefined}
						onZoomFocusChange={() => undefined}
						blankSlideRegions={slides}
						wallpaper="#000000"
						showShadow={false}
						showBlur={false}
						padding={0}
					/>
				</div>
				<output data-testid="time">{time.toFixed(2)}</output>
				<button
					type="button"
					onClick={() => setSlides([{ ...slides[0], startMs: 1000, endMs: 2000 }])}
				>
					Move slide
				</button>
				<button type="button" onClick={() => setSlides([])}>
					Delete slide
				</button>
			</>
		);
	}
	render(<Preview />);
	await waitFor(() => expect(playback.current?.videoSprite).toBeTruthy(), { timeout: 15_000 });
	act(() => playback.current!.seek(1.2));
	await waitFor(() => expect(playback.current!.video!.currentTime).toBeCloseTo(0.5, 2));
	expect(screen.getByTestId("time").textContent).toBe("1.20");
	await userEvent.click(screen.getByRole("button", { name: "Move slide" }));
	await waitFor(() => expect(playback.current!.video!.currentTime).toBeCloseTo(1, 2));
	expect(playback.current!.video!.paused).toBe(true);
	await userEvent.click(screen.getByRole("button", { name: "Delete slide" }));
	await waitFor(() => expect(playback.current!.video!.currentTime).toBeCloseTo(1.2, 2));
	expect(screen.getByTestId("time").textContent).toBe("1.20");
	expect(playback.current!.video!.paused).toBe(true);
});
